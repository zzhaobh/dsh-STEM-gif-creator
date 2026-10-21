"""Fixed, bounded Manim renderer for the Spark reduceByKey explainer."""
from __future__ import annotations

import json
import math
import os
import re
import shutil
import sys
import tempfile
import unicodedata
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

WIDTH, HEIGHT, FPS = 1280, 720, 15
MAX_STORYBOARD_BYTES, MAX_ENVELOPE_BYTES = 128 * 1024, 256 * 1024
MAX_OUTPUT_BYTES = 16 * 1024 * 1024
TEMPLATE = "spark_reduce_by_key"
SOURCE_MARKER = "合成示意 · 非真实集群运行"
SOURCE_REFERENCE = "https://spark.apache.org/docs/latest/rdd-programming-guide.html"
THEMES = {
    "light": {"bg": "#f5f3ee", "card": "#ffffff", "ink": "#182b36", "muted": "#566976", "line": "#c5cfd2", "blue": "#3778bf", "teal": "#168c83", "orange": "#c8792a"},
    "dark": {"bg": "#11232b", "card": "#1c343e", "ink": "#edf4f2", "muted": "#b4c8cb", "line": "#49636e", "blue": "#77b8ff", "teal": "#65d2bc", "orange": "#f0b773"},
}

@dataclass(frozen=True)
class Packet:
    key: str
    count: int
    source: int
    destination: int

@dataclass(frozen=True)
class SparkModel:
    local_counts: tuple[dict[str, int], ...]
    totals: dict[str, int]
    routing: dict[str, int]
    packets: tuple[Packet, ...]
    raw_count: int


def _keys(value: Any, expected: set[str], context: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        raise ValueError(f"{context}: unexpected or missing fields")


def _safe_text(value: Any, max_length: int, context: str, *, painted: bool = True) -> None:
    if not isinstance(value, str) or not value.strip() or len(value) > max_length:
        raise ValueError(f"{context}: invalid text")
    if painted and any(unicodedata.category(ch) in {"Cc", "Cs", "Cf"} for ch in value):
        raise ValueError(f"{context}: control characters are not allowed")


def validate_storyboard(value: Any) -> dict:
    """Validate exactly one Spark technical scene; never accepts executable DSL."""
    _keys(value, {"title", "source", "scenes"}, "storyboard")
    try:
        size = len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    except (TypeError, ValueError) as exc:
        raise ValueError("storyboard must be JSON data") from exc
    if size > MAX_STORYBOARD_BYTES:
        raise ValueError("storyboard exceeds 128 KiB")
    _safe_text(value["title"], 80, "title")
    _safe_text(value["source"], 40000, "source", painted=False)
    scenes = value["scenes"]
    if not isinstance(scenes, list) or len(scenes) != 1:
        raise ValueError("Spark technical storyboard must contain exactly one scene")
    scene = scenes[0]
    _keys(scene, {"id", "layout", "title", "summary", "durationSeconds", "evidence", "nodes", "edges", "technical"}, "scene")
    if not isinstance(scene["id"], str) or re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,39}", scene["id"]) is None:
        raise ValueError("scene.id is invalid")
    if scene["layout"] != "technical":
        raise ValueError("only technical layout is supported by this fixed backend")
    _safe_text(scene["title"], 80, "scene.title")
    _safe_text(scene["summary"], 240, "scene.summary")
    duration = scene["durationSeconds"]
    if isinstance(duration, bool) or not isinstance(duration, int) or not 5 <= duration <= 10:
        raise ValueError("durationSeconds must be an integer from 5 to 10")
    if not isinstance(scene["evidence"], list) or not 1 <= len(scene["evidence"]) <= 8:
        raise ValueError("evidence must be a nonempty short list")
    for item in scene["evidence"]:
        _safe_text(item, 4000, "evidence", painted=False)
        if item not in value["source"]:
            raise ValueError("evidence must occur exactly in the source")
    if scene["nodes"] != [] or scene["edges"] != []:
        raise ValueError("technical scenes must not supply nodes or edges")
    tech = scene["technical"]
    _keys(tech, {"template", "partitions", "finalHoldSeconds", "sketch"}, "technical")
    if tech["template"] != TEMPLATE:
        raise ValueError("only spark_reduce_by_key template is supported")
    if type(tech["sketch"]) is not bool:
        raise ValueError("technical.sketch must be boolean")
    hold = tech["finalHoldSeconds"]
    if isinstance(hold, bool) or not isinstance(hold, (int, float)) or not math.isfinite(hold) or not 1 <= hold <= 2:
        raise ValueError("finalHoldSeconds must be finite from 1 to 2")
    if hold >= duration:
        raise ValueError("final hold must be shorter than scene duration")
    parts = tech["partitions"]
    if not isinstance(parts, list) or not 2 <= len(parts) <= 4:
        raise ValueError("partitions must contain 2–4 dense partitions")
    all_keys: list[str] = []
    for part in parts:
        if not isinstance(part, list) or not 1 <= len(part) <= 12:
            raise ValueError("each partition must contain 1–12 keys")
        for key in part:
            _safe_text(key, 16, "partition key")
            if len(key) > 16 or any(unicodedata.category(ch) in {"Cc", "Cs", "Cf"} for ch in key):
                raise ValueError("partition key contains unsupported characters")
            all_keys.append(key)
    if len(all_keys) > 24 or len(set(all_keys)) > 6:
        raise ValueError("input is limited to 24 records and 6 distinct keys")
    return value


def build_spark_model(storyboard: Any) -> SparkModel:
    """Derive map-side counts and deterministic illustrative two-way routes."""
    validate_storyboard(storyboard)
    partitions = storyboard["scenes"][0]["technical"]["partitions"]
    local = tuple(dict(Counter(part)) for part in partitions)
    totals: Counter[str] = Counter()
    for counts in local:
        totals.update(counts)
    # Deliberately illustrative, not Spark's hash partitioner.
    routing = {key: index % 2 for index, key in enumerate(sorted(totals))}
    packets = tuple(Packet(key, count, source, routing[key])
                    for source, counts in enumerate(local) for key, count in sorted(counts.items()))
    if sum(p.count for p in packets) != sum(totals.values()):
        raise ValueError("internal packet conservation failure")
    if any(p.destination != routing[p.key] for p in packets):
        raise ValueError("internal same-key routing failure")
    return SparkModel(local, dict(totals), routing, packets, sum(len(part) for part in partitions))


def frame_durations(duration_seconds: int) -> list[int]:
    """Cumulatively round 15fps frames into GIF centiseconds without drift."""
    frames = duration_seconds * FPS
    if frames > 150:
        raise ValueError("render exceeds 150-frame budget")
    result = []
    previous = 0
    for i in range(1, frames + 1):
        current = round(i * 100 / FPS)
        result.append((current - previous) * 10)
        previous = current
    if sum(result) != duration_seconds * 1000:
        raise ValueError("centisecond timeline drift")
    return result


def prepare_output_dir(path: str | Path) -> Path:
    """Require existing canonical empty non-symlink output directory."""
    target = Path(path)
    if target.is_symlink() or not target.exists() or not target.is_dir():
        raise ValueError("outputDir must be an existing real directory")
    resolved = target.resolve(strict=True)
    if resolved != target.absolute() or any(p.is_symlink() for p in [target, *target.parents]):
        raise ValueError("outputDir path must be canonical and contain no symlink components")
    if any(resolved.iterdir()):
        raise ValueError("outputDir must be empty")
    return resolved


def _draw_manim(story: dict, model: SparkModel, mp4: Path, theme_name: str) -> str:
    # Imports stay local so validation and conservation tests need no native stack.
    import manimpango
    from manim import (AnimationGroup, DOWN, UP, FadeIn, FadeOut, Line,
                       MoveAlongPath, RoundedRectangle, Scene, Text, Transform,
                       VGroup, tempconfig)
    palette = THEMES[theme_name]
    available = set(manimpango.list_fonts())
    configured = os.environ.get('GIF_CREATOR_MANIM_FONT')
    candidates = (configured,) if configured else ('Noto Sans CJK SC', 'Noto Sans SC', 'Microsoft YaHei', 'WenQuanYi Zen Hei', 'Hiragino Sans GB', 'Heiti SC')
    font = next((name for name in candidates if name in available), None)
    if font is None:
        raise RuntimeError('Chinese Text requires an installed CJK Pango family; set GIF_CREATOR_MANIM_FONT (for example Noto Sans CJK SC). Fonts are not bundled.')
    scene_spec = story["scenes"][0]
    duration = scene_spec["durationSeconds"]
    hold = scene_spec["technical"]["finalHoldSeconds"]
    # Allocate integer native frames first: arbitrary finite holds cannot alter
    # the promised duration*15 source-frame count. GIF hold is quantized separately.
    hold_frames = round(hold * FPS)
    active_frames = duration * FPS - hold_frames
    boundaries = [round(active_frames * weight / 6) for weight in (0, 1, 2, 5, 6)]
    stage_times = [(b - a) / FPS for a, b in zip(boundaries, boundaries[1:])]
    keys = sorted(model.totals)
    colors = {key: palette[{"spark": "blue", "data": "teal", "ai": "orange"}.get(key, ("blue", "teal", "orange")[i % 3])]
              for i, key in enumerate(keys)}

    class SparkScene(Scene):
        def construct(self):
            self.camera.background_color = palette["bg"]
            self.camera.background_opacity = 1

            def text(label, size=20, color=None, max_width=12.2):
                obj = Text(label, font=font, font_size=size, color=color or palette["ink"])
                if obj.width > max_width:
                    raise ValueError(f"layout overflow at font floor {size}: {label!r}")
                return obj

            def record(key, value, width=1.48, height=0.40, size=17):
                # A record is a physical labeled block, never a naked flying string.
                body = RoundedRectangle(width=width, height=height, corner_radius=0.07,
                                        stroke_color=colors[key], stroke_width=2,
                                        fill_color=palette['card'], fill_opacity=1)
                stripe = Line([-width/2+0.07, -height/2+0.06, 0],
                              [-width/2+0.07, height/2-0.06, 0], color=colors[key], stroke_width=4)
                label = text(f'{key} · {value}', size, palette['ink'], width-0.22)
                return VGroup(body, stripe, label)

            title = text(scene_spec["title"], 34).move_to([0, 3.48, 0])
            subtitle = text(scene_spec["summary"], 21, palette["muted"]).move_to([0, 2.98, 0])
            footer = text(SOURCE_MARKER, 17, palette["muted"]).move_to([0, -3.63, 0])
            assignment = text("目标分区为示意分配 · 非 Spark 实际 hash 值", 15, palette["muted"]).move_to([0, -3.20, 0])
            self.add(title, subtitle, footer, assignment)
            left_x, right_x = -4.5, 4.5
            n = len(model.local_counts)
            panel_height = 4.65 / n
            left_ys = [1.70 - panel_height * (i + 0.5) for i in range(n)]
            target_ys = [0.5, -1.65]
            for i, y in enumerate(left_ys):
                box = RoundedRectangle(width=3.6, height=panel_height - 0.12,
                                       corner_radius=0.10, stroke_width=1,
                                       stroke_color=palette["line"], fill_color=palette["card"], fill_opacity=1)
                box.move_to([left_x, y, 0])
                self.add(box, text(f"输入 P{i}", 16, palette["muted"]).move_to([left_x, y + panel_height / 2 - 0.25, 0]))
            for i, y in enumerate(target_ys):
                box = RoundedRectangle(width=3.6, height=1.95, corner_radius=0.10,
                                       stroke_width=1, stroke_color=palette["line"],
                                       fill_color=palette["card"], fill_opacity=1).move_to([right_x, y, 0])
                self.add(box, text(f"目标分区 P{i}", 16, palette["muted"]).move_to([right_x, y + 0.7, 0]))
            boundary = Line([0, -2.72, 0], [0, 1.85, 0], color=palette["line"], stroke_width=2)
            self.add(boundary, text("shuffle", 19, palette["muted"]).move_to([0, 2.05, 0]))
            caption = text("map：每条记录 → (key, 1)", 21).move_to([0, 2.48, 0])
            self.add(caption)
            # Never squeeze labels below the font floor. Schema-valid data may
            # fail layout explicitly when the fixed blog canvas cannot fit it.
            local_anchors = {}
            def grid(items, partition, raw=False):
                group = VGroup()
                count = len(items)
                columns = 2 if count > 3 else 1
                rows = math.ceil(count / columns)
                usable = panel_height - 0.65
                spacing = usable / rows
                for j, (key, value) in enumerate(items):
                    column, row = j % columns, j // columns
                    x = left_x + (column - (columns - 1) / 2) * 1.7
                    y = left_ys[partition] + panel_height / 2 - 0.52 - (row + 0.5) * spacing
                    label = record(key, value, width=1.48 if columns == 2 else 1.75)
                    if label.height + 0.08 > spacing:
                        raise ValueError("layout overflow: partition rows overlap at font floor 17")
                    label.move_to([x, y, 0])
                    if not raw:
                        local_anchors[(partition, key)] = label.get_center().copy()
                    group.add(label)
                return group
            raw_groups = VGroup(*[grid([(k, 1) for k in part], i, True)
                                   for i, part in enumerate(scene_spec["technical"]["partitions"])])
            local_groups = VGroup(*[grid(sorted(counts.items()), i)
                                     for i, counts in enumerate(model.local_counts)])
            self.play(FadeIn(raw_groups), run_time=stage_times[0])
            new_caption = text("先在分区内合并", 21).move_to(caption)
            self.play(Transform(raw_groups, local_groups), Transform(caption, new_caption), run_time=stage_times[1])
            # Stable key anchors: all packets of one key terminate at exactly the same y.
            key_anchors = {}
            for dest in range(2):
                dest_keys = [k for k in keys if model.routing[k] == dest]
                for j, key in enumerate(dest_keys):
                    key_anchors[key] = target_ys[dest] + 0.20 - j * 0.58
            # Arrival lanes must remain legible even for schema-valid 4-way input.
            for dest in range(2):
                previous_bottom = None
                for key in [k for k in keys if model.routing[k] == dest]:
                    count = sum(p.key == key for p in model.packets)
                    half_height = 0.22
                    top, bottom = key_anchors[key] + half_height, key_anchors[key] - half_height
                    if top > target_ys[dest] + 0.51 or bottom < target_ys[dest] - 0.85 or (previous_bottom is not None and top + 0.04 > previous_bottom):
                        raise ValueError("layout overflow: destination packet lanes overlap")
                    previous_bottom = bottom
            routes, packet_labels, movements = VGroup(), VGroup(), []
            for packet in model.packets:
                same_key = [p for p in model.packets if p.key == packet.key]
                offset = (same_key.index(packet) - (len(same_key) - 1) / 2) * 1.55
                if len(same_key) > 2:
                    raise ValueError('layout overflow: split more than two same-key arrivals into a separate story')
                y2 = key_anchors[packet.key]
                route = Line(local_anchors[(packet.source, packet.key)], [right_x + offset, y2, 0],
                             color=palette['line'], stroke_width=1, stroke_opacity=0.18)
                routes.add(route)
                label = record(packet.key, packet.count, width=1.40, size=16)
                label.move_to(route.get_start())
                packet_labels.add(label)
                movements.append(MoveAlongPath(label, route))
            # Move consumes the local entities; source blocks must not remain as copies.
            self.remove(raw_groups, *raw_groups)
            self.add(routes)
            self.add(packet_labels)
            self.remove(caption)
            caption = text("同 key 到同一分区", 21).move_to([0, 2.48, 0])
            self.add(caption)
            self.play(AnimationGroup(*movements, lag_ratio=0.10), run_time=stage_times[2])
            equations, reductions = VGroup(), []
            for key in keys:
                counts = [str(p.count) for p in model.packets if p.key == key]
                equation = text(f"{key}: {' + '.join(counts)}", 19, colors[key], 3.1)
                equation.move_to([right_x, key_anchors[key], 0])
                result = record(key, model.totals[key], width=2.10, height=0.46, size=21).move_to(equation)
                equations.add(equation)
                reductions.append(Transform(equation, result))
            # AnimationGroup registers packet children individually; removing
            # only the parent VGroup leaves ghost labels under the results.
            self.remove(packet_labels, *packet_labels)
            self.add(equations)
            final_caption = text("再合并局部结果", 21).move_to(caption)
            reduce_frames = round(stage_times[3] * FPS)
            self.play(Transform(caption, final_caption), run_time=1 / FPS)
            self.wait(max(1, reduce_frames // 3) / FPS, frozen_frame=False)
            self.play(*reductions, run_time=(reduce_frames - 1 - max(1, reduce_frames // 3)) / FPS)
            self.wait(hold_frames / FPS, frozen_frame=False)

    media = mp4.parent / "manim-media"
    with tempconfig({"pixel_width": WIDTH, "pixel_height": HEIGHT, "frame_rate": FPS,
                     "media_dir": str(media), "disable_caching": True,
                     "format": "mov", "transparent": True, "write_to_movie": True, "save_last_frame": False,
                     "output_file": "spark-fixed", "verbosity": "WARNING"}):
        scene = SparkScene()
        scene.render()
        movie = Path(scene.renderer.file_writer.movie_file_path)
        if not movie.is_file() or media.resolve() not in movie.resolve().parents:
            raise RuntimeError("Manim produced no private fixed movie")
        shutil.copyfile(movie, mp4)
    return font


def _extract_gif(mp4: Path, output: Path, duration: int, hold_ms: int) -> tuple[int, int]:
    from PIL import GifImagePlugin, Image
    import av
    durations = frame_durations(duration)
    frames, gif_frames = [], []
    samples = palette = None
    try:
        with av.open(str(mp4)) as container:
            for frame in container.decode(container.streams.video[0]):
                with frame.to_image() as decoded:
                    image = decoded.convert("RGB")
                frames.append(image)
                if image.size != (WIDTH, HEIGHT):
                    raise RuntimeError("native frame geometry changed")
                if len(frames) > duration * FPS or len(frames) > 150:
                    raise RuntimeError("Manim output exceeded the frame limit")
        if len(frames) != duration * FPS:
            raise RuntimeError(f"expected {duration * FPS} source frames, got {len(frames)}")
        samples = Image.new("RGB", (320 * 5, 180 * math.ceil(len(frames) / 5)))
        for i, frame in enumerate(frames):
            with frame.resize((320, 180)) as thumb:
                samples.paste(thumb, ((i % 5) * 320, (i // 5) * 180))
        palette = samples.quantize(colors=240, method=Image.Quantize.MEDIANCUT)
        # Reserve semantic theme colors exactly: thumbnail-derived palettes can
        # otherwise wash dark titles and small colored labels into low gray.
        reserved = list(dict.fromkeys(color for theme in THEMES.values() for color in theme.values()))
        rgb = [component for color in reserved for component in (int(color[1:3], 16), int(color[3:5], 16), int(color[5:7], 16))]
        rgb += palette.getpalette()[:(256 - len(reserved)) * 3]
        palette.putpalette(rgb)
        for frame in frames:
            gif_frames.append(frame.quantize(palette=palette, dither=Image.Dither.NONE))
        hold_start = duration * FPS - round(hold_ms * FPS / 1000)
        if hold_start <= 0:
            raise ValueError("hold is longer than scene")
        # Exact GIF-centisecond hold; redistribute the active frame deadlines
        # cumulatively rather than snapping arbitrary holds to a 15fps boundary.
        active_ms = duration * 1000 - hold_ms
        coalesced_durations = [round((i + 1) * active_ms / hold_start / 10) * 10
                               - round(i * active_ms / hold_start / 10) * 10
                               for i in range(hold_start)] + [hold_ms]
        coalesced_frames = gif_frames[:hold_start] + [gif_frames[-1]]
        with output.open("wb") as stream:
            header, _ = GifImagePlugin.getheader(coalesced_frames[0], info={"loop": 0, "background": 0})
            for block in header:
                stream.write(block)
            for frame, milliseconds in zip(coalesced_frames, coalesced_durations):
                for block in GifImagePlugin.getdata(frame, duration=milliseconds, disposal=1, include_color_table=False):
                    stream.write(block)
                if stream.tell() > MAX_OUTPUT_BYTES:
                    raise RuntimeError("GIF exceeds 16 MiB budget")
            stream.write(b";")
        with Image.open(output) as gif:
            encoded_count = gif.n_frames
            encoded_duration = 0
            for index in range(encoded_count):
                gif.seek(index)
                encoded_duration += gif.info["duration"]
            if encoded_duration != duration * 1000 or gif.info["duration"] != hold_ms:
                raise RuntimeError("encoded GIF timing validation failed")
        return len(frames), encoded_count
    finally:
        for image in frames + gif_frames:
            image.close()
        if samples is not None:
            samples.close()
        if palette is not None:
            palette.close()


def _make_overview(gif_path: Path, output: Path) -> None:
    from PIL import Image
    with Image.open(gif_path) as gif:
        gif.seek(gif.n_frames - 1)
        with gif.convert("RGB") as image:
            image.save(output, format="PNG", optimize=True)


def render_storyboard(storyboard: Any, output_dir: str | Path, theme: str = "light") -> dict:
    """Render the fixed template and write only four allowlisted outputs."""
    validate_storyboard(storyboard)
    if theme not in THEMES:
        raise ValueError("theme must be light or dark")
    output = prepare_output_dir(output_dir)
    model = build_spark_model(storyboard)
    scene = storyboard["scenes"][0]
    duration = scene["durationSeconds"]
    hold = round(scene["technical"]["finalHoldSeconds"] * 100) * 10
    private_owner = tempfile.TemporaryDirectory(prefix="spark-manim-")
    private = Path(private_owner.name)
    try:
        mp4 = private / "render.mov"
        font = _draw_manim(storyboard, model, mp4, theme)
        source_frames, frame_count = _extract_gif(mp4, output / "animation.gif", duration, hold)
        _make_overview(output / "animation.gif", output / "overview.png")
        # Final completed scene, matching the ordinary renderer's scene poster.
        _make_overview(output / "animation.gif", output / "scene-1.png")
        files = [output / name for name in ("animation.gif", "overview.png", "scene-1.png")]
        for path in files:
            if path.stat().st_size > MAX_OUTPUT_BYTES:
                raise RuntimeError(f"output exceeds 16 MiB: {path.name}")
        gif_bytes = (output / "animation.gif").stat().st_size
        metrics = {"width": WIDTH, "height": HEIGHT, "frameCount": frame_count,
                   "durationMs": duration * 1000, "finalHoldMs": hold, "loop": 0,
                   "bytes": gif_bytes, "sourceFrameCount": source_frames,
                   "rawRecordCount": model.raw_count, "shufflePacketCount": len(model.packets),
                   "totals": model.totals, "routing": model.routing,
                   "font": font, "template": TEMPLATE,
                   "synthetic": True, "theme": theme}
        (output / "metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        if (output / "metrics.json").stat().st_size > MAX_OUTPUT_BYTES:
            raise RuntimeError("metrics.json exceeds 16 MiB")
        return metrics
    except Exception:
        # Never leave partial generated deliverables after a render error.
        for name in ("animation.gif", "overview.png", "scene-1.png", "metrics.json"):
            candidate = output / name
            if candidate.exists() and not candidate.is_symlink():
                candidate.unlink()
        raise
    finally:
        private_owner.cleanup()


def main() -> int:
    raw = sys.stdin.buffer.read(MAX_ENVELOPE_BYTES + 1)
    if len(raw) > MAX_ENVELOPE_BYTES:
        raise ValueError("input envelope exceeds 256 KiB")
    request = json.loads(raw)
    _keys(request, {"storyboard", "outputDir", "theme"}, "request")
    if not isinstance(request["outputDir"], str) or len(request["outputDir"]) > 4096:
        raise ValueError("outputDir must be a bounded string")
    result = render_storyboard(request["storyboard"], request["outputDir"], request["theme"])
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"manim_backend: {type(exc).__name__}: {exc}", file=sys.stderr)
        raise SystemExit(2)
