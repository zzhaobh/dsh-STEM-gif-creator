"""Fixed JSON-to-GIF renderer. No user code, scripts, or dynamic evaluation."""

from __future__ import annotations

import json
import math
import os
import re
import sys
import unicodedata
from pathlib import Path
from typing import Any

WIDTH, HEIGHT = 1280, 720
MAX_INPUT_BYTES = 256 * 1024  # Envelope allowance; storyboard is checked independently.
MAX_STORYBOARD_BYTES = 128 * 1024
MAX_OUTPUT_BYTES = 16 * 1024 * 1024
MAX_FRAMES = 156
FONT_CANDIDATES = (
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    str(Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts' / 'msyh.ttc'),
)
THEMES = {
    "light": {"bg": "#f5f3ee", "card": "#ffffff", "ink": "#182b36", "muted": "#566976", "line": "#c5cfd2", "accent": "#087f78", "wash": "#def2eb", "secondary": "#c37c32"},
    "dark": {"bg": "#11232b", "card": "#1c343e", "ink": "#edf4f2", "muted": "#b4c8cb", "line": "#49636e", "accent": "#7dd9bc", "wash": "#254e4d", "secondary": "#edb76f"},
}


def _keys(value: Any, expected: set[str], context: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        raise ValueError(f"{context}: required/unknown fields; expected {', '.join(sorted(expected))}")


def _text(value: Any, bound: int, context: str, allow_empty: bool = False, painted: bool = True) -> None:
    if not isinstance(value, str) or len(value) > bound or (not allow_empty and not value.strip()):
        raise ValueError(f"{context}: text must contain {'0' if allow_empty else '1'}–{bound} characters")
    if painted and any(unicodedata.category(char) in {"Cc", "Cs", "Cf"} and char != "\n" for char in value):
        raise ValueError(f"{context}: unsupported control/format character in painted text")


def _identifier(value: Any, context: str) -> None:
    if not isinstance(value, str) or re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,39}", value) is None:
        raise ValueError(f"{context}: id must start with an ASCII letter and contain 1–40 letters, digits, underscores or hyphens")


def _validate_chart(chart: Any) -> None:
    _keys(chart, {"type", "xLabel", "yLabel", "yUnit", "baseline", "categories", "series"}, "chart")
    if chart["type"] not in ("line", "bar"):
        raise ValueError("chart.type: expected line or bar")
    _text(chart["xLabel"], 60, "chart.xLabel")
    _text(chart["yLabel"], 60, "chart.yLabel")
    _text(chart["yUnit"], 20, "chart.yUnit", True)
    baseline = chart["baseline"]
    if isinstance(baseline, bool) or not isinstance(baseline, (int, float)) or not math.isfinite(baseline) or abs(baseline) > 1e12:
        raise ValueError("chart.baseline: expected finite number within 1e12")
    if chart["type"] == "bar" and baseline != 0:
        raise ValueError("chart.baseline: bars require a zero baseline")
    categories = chart["categories"]
    if not isinstance(categories, list) or not 2 <= len(categories) <= 12:
        raise ValueError("chart.categories: expected 2–12 categories")
    for category in categories:
        _text(category, 40, "chart.category")
    if len(set(categories)) != len(categories):
        raise ValueError("chart.categories: values must be unique")
    series = chart["series"]
    if not isinstance(series, list) or not 1 <= len(series) <= 3:
        raise ValueError("chart.series: expected 1–3 series")
    identifiers = set()
    for item in series:
        _keys(item, {"id", "label", "values"}, "chart.series")
        _identifier(item["id"], "chart.series.id")
        if item["id"] in identifiers:
            raise ValueError("chart.series.id: duplicate id")
        identifiers.add(item["id"])
        _text(item["label"], 60, "chart.series.label")
        values = item["values"]
        if not isinstance(values, list) or len(values) != len(categories):
            raise ValueError("chart.series.values: must densely match categories")
        for value in values:
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or abs(value) > 1e12 or value < baseline:
                raise ValueError("chart.series.values: expected finite values >= baseline within 1e12")


def validate_storyboard(value: Any) -> dict:
    """Validate the full untrusted storyboard without changing any supplied facts."""
    _keys(value, {"title", "source", "scenes"}, "storyboard")
    # Apply the independent serialized storyboard limit before field diagnostics.
    if len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > MAX_STORYBOARD_BYTES:
        raise ValueError("storyboard: input byte limit exceeded (128 KiB)")
    _text(value["title"], 80, "title")
    _text(value["source"], 40000, "source", painted=False)
    scenes = value["scenes"]
    if not isinstance(scenes, list) or not 1 <= len(scenes) <= 12:
        raise ValueError("scenes: expected 1–12 scenes")
    scene_ids = set()
    total_duration = 0
    for scene in scenes:
        expected = {"id", "layout", "title", "summary", "durationSeconds", "evidence", "nodes", "edges"}
        is_chart = isinstance(scene, dict) and scene.get("layout") == "chart"
        if is_chart:
            expected.add("chart")
        _keys(scene, expected, "scene")
        _identifier(scene["id"], "scene.id")
        if scene["id"] in scene_ids:
            raise ValueError("scene.id: duplicate id")
        scene_ids.add(scene["id"])
        if scene["layout"] not in ("flow", "cause", "compare", "hierarchy", "chart"):
            raise ValueError("scene.layout: expected flow, cause, compare, hierarchy or chart")
        if is_chart:
            _validate_chart(scene["chart"])
        _text(scene["title"], 80, "scene.title")
        _text(scene["summary"], 240, "scene.summary")
        duration = scene["durationSeconds"]
        if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not math.isfinite(duration) or not float(duration).is_integer() or not 3 <= duration <= 30:
            raise ValueError("durationSeconds: expected integer from 3–30 seconds")
        total_duration += int(duration) * 1000
        evidence = scene["evidence"]
        if not isinstance(evidence, list) or not 1 <= len(evidence) <= 8:
            raise ValueError("scene.evidence: expected 1–8 exact source excerpts")
        for excerpt in evidence:
            _text(excerpt, 4000, "scene.evidence", painted=False)
            if excerpt not in value["source"]:
                raise ValueError("scene.evidence: excerpt does not occur exactly in source")
        nodes = scene["nodes"]
        if not isinstance(nodes, list) or (len(nodes) != 0 if is_chart else not 2 <= len(nodes) <= 6):
            raise ValueError("scene.nodes: charts require no nodes; diagrams require 2–6 nodes")
        ids = set()
        for node in nodes:
            _keys(node, {"id", "label", "detail"}, "node")
            _identifier(node["id"], "node.id")
            if node["id"] in ids:
                raise ValueError("node.id: duplicate id")
            ids.add(node["id"])
            _text(node["label"], 60, "node.label")
            _text(node["detail"], 240, "node.detail", True)
        edges = scene["edges"]
        if not isinstance(edges, list) or (len(edges) != 0 if is_chart else len(edges) > 12):
            raise ValueError("scene.edges: charts require no edges; diagrams allow at most 12")
        if scene["layout"] in ("flow", "cause") and not edges:
            raise ValueError("scene.edges: flow/cause requires at least one explicit edge")
        if scene["layout"] == "compare" and (len(nodes) != 2 or edges):
            raise ValueError("compare: requires exactly two nodes and no arrows")
        adjacency = {identifier: [] for identifier in ids}
        pairs = set()
        for edge in edges:
            _keys(edge, {"from", "to", "label"}, "edge")
            _identifier(edge["from"], "edge.from")
            _identifier(edge["to"], "edge.to")
            if edge["from"] not in ids or edge["to"] not in ids or edge["from"] == edge["to"]:
                raise ValueError("edge: missing endpoint or self edge")
            pair = (edge["from"], edge["to"])
            if pair in pairs:
                raise ValueError("edge: duplicate relationship")
            pairs.add(pair)
            adjacency[edge["from"]].append(edge["to"])
            _text(edge["label"], 60, "edge.label", True)
        if scene["layout"] == "hierarchy":
            _, order = _topology(scene)
            if len(order) != len(ids):
                raise ValueError("hierarchy: cycle detected; expected acyclic relationships")
    if total_duration > 360000:
        raise ValueError("durationSeconds: total duration exceeds 360 seconds")
    return value


def _font_path(configured: str | None = None) -> str:
    preferred = configured or os.environ.get("GIF_CREATOR_FONT")
    candidates = (preferred,) if preferred else FONT_CANDIDATES
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    raise ValueError("font: Chinese font unavailable; set GIF_CREATOR_FONT to an installed font path")


def load_font(size: int, configured: str | None = None):
    from PIL import ImageFont

    try:
        return ImageFont.truetype(_font_path(configured), size)
    except OSError as error:
        raise ValueError("font: cannot load configured font") from error


def _clusters(text: str) -> list[str]:
    clusters: list[str] = []
    for char in text:
        if clusters and (unicodedata.combining(char) or char in "\ufe0e\ufe0f"):
            clusters[-1] += char
        else:
            clusters.append(char)
    return clusters


def wrap_text(text: str, font, width: float, max_lines: int | None = None) -> list[str]:
    """Wrap measured Unicode clusters, preferring Latin words and numeric units."""
    if width <= 0:
        raise ValueError("text overflow: width must be positive")
    lines = []
    for paragraph in text.split("\n"):
        tokens = re.findall(r"[A-Za-z0-9]+(?:[.,][0-9]+)*(?:[°%][A-Za-z]*)?(?:[ ](?:秒|毫秒|分钟|小时|MB|GB|ms|kg|cm))?|[^A-Za-z0-9]", paragraph)
        merged = []
        for token in tokens:
            if merged and all(unicodedata.combining(c) or c in "\ufe0e\ufe0f" for c in token):
                merged[-1] += token
            else:
                merged.append(token)
        line = ""
        for token in merged:
            parts = _clusters(token) if font.getlength(token) > width else [token]
            for part in parts:
                if font.getlength(part) > width:
                    raise ValueError("text overflow: glyph does not fit width; split scene")
                if line and font.getlength(line + part) > width:
                    lines.append(line.rstrip())
                    line = ""
                if line or not part.isspace():
                    line += part
        lines.append(line.rstrip())
    if max_lines is not None and len(lines) > max_lines:
        raise ValueError(f"text overflow: {len(lines)} lines exceed {max_lines}; split scene")
    return lines


def _box_text(text: str, size: int, box: tuple, color: str, fonts: dict, context: str) -> dict:
    font = fonts.setdefault(size, load_font(size))
    x, y, width, height = box
    line_height = math.ceil(size * 1.4)
    lines = wrap_text(text, font, width, max_lines=int(height // line_height))
    for line in lines:
        bounds = font.getbbox(line)
        if bounds[2] - bounds[0] > width + 1 or bounds[3] - bounds[1] > line_height:
            raise ValueError(f"{context}: measured glyph overflow; split scene")
    return {"lines": lines, "font": font, "x": x, "y": y, "lineHeight": line_height, "color": color}


def _topology(scene: dict) -> tuple[dict, list]:
    ids = sorted(node["id"] for node in scene["nodes"])
    adjacency = {identifier: [] for identifier in ids}
    indegree = dict.fromkeys(ids, 0)
    depths = dict.fromkeys(ids, 0)
    for edge in scene["edges"]:
        adjacency[edge["from"]].append(edge["to"])
        indegree[edge["to"]] += 1
    queue = sorted(identifier for identifier in ids if indegree[identifier] == 0)
    order = []
    while queue:
        identifier = queue.pop(0)
        order.append(identifier)
        for child in sorted(adjacency[identifier]):
            depths[child] = max(depths[child], depths[identifier] + 1)
            indegree[child] -= 1
            if indegree[child] == 0:
                queue.append(child)
                queue.sort()
    return depths, order


def _hierarchy_geometry(scene: dict) -> tuple[dict, list, list]:
    """Lay out all DAG components using longest topological depth and stable IDs."""
    depths, order = _topology(scene)
    if len(order) != len(scene["nodes"]):
        raise ValueError("hierarchy: cycle detected")
    levels = max(depths.values()) + 1
    boxes = {}
    column_gap = 28
    width = min(312, (1152 - column_gap * (levels - 1)) / levels)
    max_rows = max(sum(depth == current for depth in depths.values()) for current in range(levels))
    height = min(142, (348 - 24 * (max_rows - 1)) / max_rows)
    for depth in range(levels):
        members = sorted(identifier for identifier in depths if depths[identifier] == depth)
        column_height = len(members) * height + max(0, len(members) - 1) * 24
        top = 247 + (348 - column_height) / 2
        for index, identifier in enumerate(members):
            boxes[identifier] = (64 + depth * (width + column_gap), top + index * (height + 24), width, height)
    return depths, [boxes[node["id"]] for node in scene["nodes"]], order


def _positions(scene: dict) -> list[tuple]:
    count = len(scene["nodes"])
    if scene["layout"] == "chart":
        return []
    if scene["layout"] == "compare":
        return [(64, 260, 552, 250), (664, 260, 552, 250)]
    if count <= 3 and scene["layout"] == "flow":
        gap = 76
        width = (1152 - gap * (count - 1)) / count
        return [(64 + i * (width + gap), 295, width, 192) for i in range(count)]
    if count > 3 and scene["layout"] == "flow":
        return [(64 + i * 420, 247, 312, 142) for i in range(3)] + [(64 + i * 420, 453, 312, 142) for i in reversed(range(3))][:count - 3]
    if scene["layout"] == "cause":
        remaining = count - 1
        root_height = 192 if count == 2 else 142
        root = (64, 359 - root_height / 2, 312, root_height)
        if remaining <= 2:
            ys = [247, 453] if remaining == 2 else [338]
            return [root] + [(904, y, 312, 142) for y in ys]
        return [(64 + 420 * index, 247, 312, 142) for index in range(min(3, count))] + [(64 + 420 * index, 453, 312, 142) for index in reversed(range(min(3, count - 3)))]
    if scene["layout"] == "hierarchy":
        return _hierarchy_geometry(scene)[1]
    raise ValueError("unsupported diagram layout")


def _edge_points(start: tuple, end: tuple) -> tuple:
    """Intersect the source-to-target center ray with each rectangular boundary."""
    x, y, width, height = start
    tx, ty, tw, th = end
    center = (x + width / 2, y + height / 2)
    target = (tx + tw / 2, ty + th / 2)
    dx, dy = target[0] - center[0], target[1] - center[1]
    if dx == 0 and dy == 0:
        raise ValueError("edge geometry: coincident card centers")
    scale_a = min(width / (2 * abs(dx)) if dx else math.inf, height / (2 * abs(dy)) if dy else math.inf)
    scale_b = min(tw / (2 * abs(dx)) if dx else math.inf, th / (2 * abs(dy)) if dy else math.inf)
    return ((center[0] + scale_a * dx, center[1] + scale_a * dy), (target[0] - scale_b * dx, target[1] - scale_b * dy))


def _segment_crosses_card(a: tuple, b: tuple, card: tuple) -> bool:
    """Test open rectangle intersection using a parametric line clipping interval."""
    x, y, width, height = card
    low, high = 0.0, 1.0
    for origin, delta, minimum, maximum in ((a[0], b[0] - a[0], x + 1, x + width - 1), (a[1], b[1] - a[1], y + 1, y + height - 1)):
        if delta == 0:
            if not minimum < origin < maximum:
                return False
        else:
            enter, leave = sorted(((minimum - origin) / delta, (maximum - origin) / delta))
            low, high = max(low, enter), min(high, leave)
            if low >= high:
                return False
    return low < high


def _prepare(storyboard: dict, colors: dict, font_path: str) -> list[dict]:
    from matplotlib.ft2font import FT2Font

    supported = FT2Font(font_path).get_charmap()
    text = storyboard["title"]
    for scene in storyboard["scenes"]:
        text += scene["title"] + scene["summary"]
        text += "".join(node["label"] + node["detail"] for node in scene["nodes"])
        text += "".join(edge["label"] for edge in scene["edges"])
        if scene["layout"] == "chart":
            chart = scene["chart"]
            text += chart["xLabel"] + chart["yLabel"] + chart["yUnit"] + "".join(chart["categories"]) + "".join(series["label"] for series in chart["series"])
    missing = sorted({ord(char) for char in text if not char.isspace() and ord(char) not in supported})
    if missing:
        raise ValueError("font: missing glyph coverage for " + ", ".join(f"U+{code:04X}" for code in missing[:8]))
    prepared = []
    fonts: dict = {}
    for number, scene in enumerate(storyboard["scenes"], 1):
        positions = _positions(scene)
        text_boxes = [
            _box_text(storyboard["title"], 20, (64, 30, 980, 30), colors["muted"], fonts, "storyboard title"),
            _box_text(scene["title"], 40, (64, 85, 1152, 62), colors["ink"], fonts, "scene title"),
            _box_text(scene["summary"], 23, (64, 158, 1152, 66), colors["muted"], fonts, "summary"),
        ]
        node_boxes = []
        for node, (x, y, width, height) in zip(scene["nodes"], positions):
            compact = height < 180
            label_y = y + 43
            label_h = 42 if compact else 76
            detail_y = label_y + label_h + 2
            detail_height = max(22, y + height - detail_y - 10)
            node_boxes.append([
                _box_text(node["label"], 25 if compact else 28, (x + 20, label_y, width - 40, min(label_h, height - 42)), colors["ink"], fonts, "node label"),
                _box_text(node["detail"], 18 if compact else 23, (x + 20, detail_y, width - 40, detail_height), colors["muted"], fonts, "node detail"),
            ])
        # Evidence remains exact and unmodified in validated storyboard; display reviewer hint.
        text_boxes.append(_box_text("依据请在项目中核对原文与数值。", 17, (64, 635, 1152, 53), colors["muted"], fonts, "reading note"))
        edge_boxes = []
        ids = {node["id"]: i for i, node in enumerate(scene["nodes"])}
        for edge in scene["edges"]:
            source_index, target_index = ids[edge["from"]], ids[edge["to"]]
            start, end = positions[source_index], positions[target_index]
            a, b = _edge_points(start, end)
            if any(_segment_crosses_card(a, b, card) for index, card in enumerate(positions) if index not in (source_index, target_index)):
                raise ValueError("edge geometry crosses another card; split scene or change layout")
            mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            label_width = min(180, max(100, abs(a[0] - b[0]) - 8))
            if abs(a[0] - b[0]) < 50:
                label_width = 155
                mid = (mid[0] - 88, mid[1])
            elif abs((start[1] + start[3] / 2) - (end[1] + end[3] / 2)) >= 30:
                mid = (mid[0] - 70, mid[1])
            label = _box_text(edge["label"], 17, (mid[0] - label_width / 2, mid[1] - 15, label_width, 52), colors["accent"], fonts, "edge label")
            label_height = len(label["lines"]) * label["lineHeight"]
            if label["x"] < 32 or label["x"] + label_width > WIDTH - 32 or label["y"] < 224 or label["y"] + label_height > 625:
                raise ValueError("edge label overflow: split scene or shorten relationship label")
            edge_boxes.append({"a": a, "b": b, "label": label, "from": source_index, "to": target_index})
        _, order = _topology(scene)
        order = order if len(order) == len(scene["nodes"]) else [node["id"] for node in scene["nodes"]]
        prepared.append({"scene": scene, "positions": positions, "text": text_boxes, "nodes": node_boxes, "edges": edge_boxes, "number": number, "order": [ids[identifier] for identifier in order]})
    return prepared


def _draw_text(draw, item: dict, background: str | None = None) -> None:
    for index, line in enumerate(item["lines"]):
        x, y = item["x"], item["y"] + index * item["lineHeight"]
        if background and line:
            draw.rounded_rectangle((x - 5, y - 3, x + item["font"].getlength(line) + 5, y + item["lineHeight"] - 1), radius=4, fill=background)
        draw.text((x, y), line, font=item["font"], fill=item["color"], anchor="lt")


def _decorate(image, prepared: dict, colors: dict, scene_count: int):
    from PIL import ImageDraw

    draw = ImageDraw.Draw(image)
    draw.line((64, 615, 1216, 615), fill=colors["line"], width=1)
    for item in prepared["text"]:
        _draw_text(draw, item)
    number = prepared["number"]
    draw.text((1216, 35), f"{number:02d} / {scene_count:02d}", font=load_font(18), fill=colors["muted"], anchor="rt")
    for index in range(scene_count):
        x = 64 + index * (1152 / scene_count)
        draw.rounded_rectangle((x, 702, x + 1152 / scene_count - 6, 707), radius=2, fill=colors["accent"] if index < number else colors["line"])
    return image


def _render_frame(prepared: dict, highlighted: int, colors: dict, scene_count: int):
    import matplotlib
    matplotlib.use("Agg")
    import numpy as np
    from matplotlib.backends.backend_agg import FigureCanvasAgg
    from matplotlib.figure import Figure
    from matplotlib.patches import FancyArrowPatch, FancyBboxPatch
    from PIL import Image, ImageDraw

    figure = Figure(figsize=(12.8, 7.2), dpi=100, facecolor=colors["bg"])
    canvas = FigureCanvasAgg(figure)
    axes = figure.add_axes((0, 0, 1, 1))
    axes.set(xlim=(0, WIDTH), ylim=(HEIGHT, 0))
    axes.set_axis_off()
    active_nodes = set(prepared["order"][:highlighted])
    for edge in prepared["edges"]:
        active = edge["from"] in active_nodes and edge["to"] in active_nodes
        axes.add_patch(FancyArrowPatch(edge["a"], edge["b"], arrowstyle="-|>", mutation_scale=17, linewidth=2.3, color=colors["accent"] if active else colors["line"], connectionstyle="arc3,rad=0", shrinkA=0, shrinkB=0, zorder=1))
    for index, (x, y, width, height) in enumerate(prepared["positions"]):
        active = index in active_nodes
        axes.add_patch(FancyBboxPatch((x, y + 5), width, height, boxstyle="round,pad=0,rounding_size=15", facecolor=colors["line"], edgecolor="none", alpha=0.18, zorder=2))
        axes.add_patch(FancyBboxPatch((x, y), width, height, boxstyle="round,pad=0,rounding_size=15", facecolor=colors["wash"] if active else colors["card"], edgecolor=colors["accent"] if active else colors["line"], linewidth=2 if active else 1, zorder=3))
    canvas.draw()
    image = Image.fromarray(np.asarray(canvas.buffer_rgba())[:, :, :3].copy())
    figure.clear()
    draw = ImageDraw.Draw(image)
    badge_font = load_font(16)
    for index, ((x, y, width, height), boxes) in enumerate(zip(prepared["positions"], prepared["nodes"])):
        active = index in active_nodes
        draw.rounded_rectangle((x + 20, y + 13, x + 50, y + 35), radius=6, fill=colors["accent"] if active else colors["line"])
        draw.text((x + 27, y + 16), str(prepared["order"].index(index) + 1).zfill(2), font=badge_font, fill=colors["bg"], anchor="lt")
        for item in boxes:
            _draw_text(draw, item)
    for edge in prepared["edges"]:
        _draw_text(draw, edge["label"], colors["bg"])
    return _decorate(image, prepared, colors, scene_count)


def _chart_frames(prepared: dict, colors: dict, scene_count: int, engine: str):
    """Produce only observed-category snapshots with fixed axes and legend."""
    import matplotlib
    matplotlib.use("Agg")
    import numpy as np
    from matplotlib.backends.backend_agg import FigureCanvasAgg
    from matplotlib.figure import Figure
    from matplotlib.font_manager import FontProperties
    from matplotlib.lines import Line2D
    from matplotlib.patches import Patch
    from PIL import Image

    chart = prepared["scene"]["chart"]
    figure = Figure(figsize=(12.8, 7.2), dpi=100, facecolor=colors["bg"])
    canvas = FigureCanvasAgg(figure)
    axes = figure.add_axes((0.12, 0.24, 0.81, 0.37), facecolor=colors["bg"])
    font = FontProperties(fname=_font_path(), size=13)
    axes.set_autoscale_on(False)
    count = len(chart["categories"])
    maximum = max(value for item in chart["series"] for value in item["values"])
    span = maximum - chart["baseline"]
    upper = maximum + (span * 0.12 if span else max(1, abs(maximum) * 0.05))
    axes.set(xlim=(-0.6, count - 0.4), ylim=(chart["baseline"], upper))
    axes.set_xticks(range(count), chart["categories"], fontproperties=font)
    axes.set_xlabel(chart["xLabel"], fontproperties=font, color=colors["ink"])
    axes.set_ylabel(chart["yLabel"] + (f" ({chart['yUnit']})" if chart["yUnit"] else ""), fontproperties=font, color=colors["ink"])
    axes.tick_params(colors=colors["muted"], labelsize=12)
    axes.ticklabel_format(axis="y", style="plain", useOffset=False)
    axes.grid(axis="y", color=colors["line"], alpha=0.6)
    axes.set_axisbelow(True)
    for spine in axes.spines.values():
        spine.set_color(colors["line"])
    series_colors = [colors["accent"], colors["secondary"], colors["ink"]]
    handles = [(Patch(facecolor=series_colors[index], label=item["label"]) if chart["type"] == "bar" else Line2D([], [], color=series_colors[index], marker="o", label=item["label"])) for index, item in enumerate(chart["series"])]
    legend = axes.legend(handles=handles, prop=font, loc="lower left", bbox_to_anchor=(0, 1.02), borderaxespad=0, ncol=len(chart["series"]), frameon=False, labelcolor=colors["ink"])
    # Camera tracks collections/lines/patches/text and hides prior snapshots. Keep
    # labels, ticks and legend as fixed axis state; no Camera.animate GIF export.
    camera = None
    if engine == "celluloid":
        try:
            from celluloid import Camera
            camera = Camera(figure)
        except ImportError as error:
            raise ValueError("animationEngine celluloid: Celluloid 0.2.0 is unavailable") from error
    canvas.draw()
    renderer = canvas.get_renderer()
    for text in [*axes.get_xticklabels(), axes.xaxis.label, axes.yaxis.label, *legend.get_texts()]:
        bounds = text.get_window_extent(renderer)
        if bounds.x0 < 20 or bounds.x1 > WIDTH - 20 or bounds.y0 < 20 or bounds.y1 > HEIGHT - 20:
            raise ValueError("chart text overflow: split scene or shorten labels")
    for item in legend.get_texts():
        if HEIGHT - item.get_window_extent(renderer).y1 < 230:
            raise ValueError('chart legend overflow: overlaps summary; shorten labels')
    if HEIGHT - axes.xaxis.label.get_window_extent(renderer).y0 > 610:
        raise ValueError('chart axis overflow: overlaps source note; shorten labels')
    labels = axes.get_xticklabels()
    if any(labels[index].get_window_extent(renderer).x1 + 6 > labels[index + 1].get_window_extent(renderer).x0 for index in range(len(labels) - 1)):
        raise ValueError("chart category overflow: labels overlap; split scene")
    previous = []
    try:
        for revealed in range(count + 1):
            for artist in previous:
                artist.set_visible(False)
            current = []
            for index, item in enumerate(chart["series"]):
                values = item["values"][:revealed]
                if chart["type"] == "line":
                    current.extend(axes.plot(range(revealed), values, color=series_colors[index], marker="o", linewidth=2.5, markersize=7))
                else:
                    width = 0.76 / len(chart["series"])
                    xs = [x + (index - (len(chart["series"]) - 1) / 2) * width for x in range(revealed)]
                    current.extend(axes.bar(xs, values, width=width, bottom=0, color=series_colors[index]))
            if camera is not None:
                # Camera 0.2.0 re-adds the legend on every snap. The legend is
                # fixed axis state, not a snapshot artist; avoid overpainting it.
                axes.legend_ = None
                try:
                    snapshot = camera.snap()
                finally:
                    axes.legend_ = legend
                if any(artist not in snapshot for artist in current):
                    raise ValueError("animationEngine celluloid: missing chart artists in snapshot")
            else:
                canvas.draw()
                image = Image.fromarray(np.asarray(canvas.buffer_rgba())[:, :, :3].copy())
                yield _decorate(image, prepared, colors, scene_count)
            previous = current
        if camera is not None:
            if len(camera._photos) != count + 1:
                raise ValueError("animationEngine celluloid: snapshot count mismatch")
            animation = camera.animate()
            animation._init_draw()
            for index, artists in enumerate(camera._photos):
                if index:
                    animation._pre_draw(artists, blit=False)
                animation._draw_frame(artists)
                canvas.draw()
                image = Image.fromarray(np.asarray(canvas.buffer_rgba())[:, :, :3].copy())
                yield _decorate(image, prepared, colors, scene_count)
    except Exception as error:
        if engine == "celluloid":
            raise ValueError(f"animationEngine celluloid failed: {error}") from error
        raise
    finally:
        figure.clear()


def _palette(colors: dict):
    from PIL import Image, ImageColor

    entries = []
    background = ImageColor.getrgb(colors["bg"])
    for color in colors.values():
        rgb = ImageColor.getrgb(color)
        for step in range(32):
            entries.extend(round(background[channel] + (rgb[channel] - background[channel]) * step / 31) for channel in range(3))
    image = Image.new("P", (1, 1))
    image.putpalette(entries[:768])
    return image


def _output_directory(value: str | Path) -> Path:
    if not isinstance(value, (str, Path)) or not str(value) or "\x00" in str(value):
        raise ValueError("outputDir: invalid output path")
    path = Path(value)
    if not path.is_absolute() or ".." in path.parts or path == Path(path.anchor):
        raise ValueError("outputDir: expected non-root absolute path without parent traversal")
    cursor = Path(path.anchor)
    existing_symlinks = []
    for component in path.parts[1:]:
        cursor /= component
        if cursor.is_symlink():
            existing_symlinks.append(cursor)
    if path.exists() and path.is_symlink():
        raise ValueError("outputDir: symlink path components are not allowed")
    if any(link != Path("/var") and link != path for link in existing_symlinks):
        raise ValueError("outputDir: symlink path components are not allowed")
    if path.exists() and not path.is_dir():
        raise ValueError("outputDir: expected a real directory")
    return path


def _check_output_size(path: Path) -> None:
    if path.stat().st_size > MAX_OUTPUT_BYTES:
        raise ValueError(f"output: {path.name} exceeds 16 MiB budget; split storyboard")


def render_storyboard(storyboard: dict, output_dir: str | Path, theme: str = "light", animation_engine: str = "matplotlib") -> dict:
    """Render bounded frames, write a single-palette GIF, then measure the file."""
    from PIL import GifImagePlugin, Image

    validate_storyboard(storyboard)
    if not isinstance(theme, str) or theme not in THEMES:
        raise ValueError("theme: expected light or dark")
    if animation_engine not in ("matplotlib", "celluloid"):
        raise ValueError("animationEngine: expected matplotlib or celluloid")
    output = _output_directory(output_dir)
    colors = THEMES[theme]
    prepared = _prepare(storyboard, colors, _font_path())
    planned_frames = sum((len(item["scene"]["chart"]["categories"]) if item["scene"]["layout"] == "chart" else len(item["nodes"])) + 1 for item in prepared)
    if planned_frames > MAX_FRAMES:
        raise ValueError("frame limit exceeded")
    output.mkdir(parents=True, exist_ok=True)
    palette = _palette(colors)
    frames, durations, scene_durations = [], [], []
    overview = Image.new("RGB", (WIDTH, HEIGHT * len(prepared)), colors["bg"])
    try:
        for index, item in enumerate(prepared):
            is_chart = item["scene"]["layout"] == "chart"
            count = len(item["scene"]["chart"]["categories"]) if is_chart else len(item["nodes"])
            duration = int(item["scene"]["durationSeconds"]) * 1000
            scene_durations.append(duration)
            images = _chart_frames(item, colors, len(prepared), animation_engine) if is_chart else (_render_frame(item, highlighted, colors, len(prepared)) for highlighted in range(count + 1))
            for highlighted, image in enumerate(images):
                try:
                    frames.append(image.quantize(palette=palette, dither=Image.Dither.NONE))
                    durations.append(100 if highlighted < count else duration - count * 100)
                    if highlighted == count:
                        scene_path = output / f"scene-{index + 1}.png"
                        image.save(scene_path, optimize=True)
                        _check_output_size(scene_path)
                        overview.paste(image, (0, HEIGHT * index))
                finally:
                    image.close()
        gif_path = output / "animation.gif"
        with gif_path.open("wb") as stream:
            header, _ = GifImagePlugin.getheader(frames[0], info={"loop": 0, "background": 0})
            for block in header:
                stream.write(block)
            for frame, duration in zip(frames, durations):
                for block in GifImagePlugin.getdata(frame, duration=duration, disposal=1, include_color_table=False):
                    stream.write(block)
                if stream.tell() >= MAX_OUTPUT_BYTES:
                    raise ValueError("output: GIF exceeds 16 MiB budget; split storyboard")
            stream.write(b";")
        _check_output_size(gif_path)
        overview.save(output / "overview.png", optimize=True)
        _check_output_size(output / "overview.png")
        with Image.open(gif_path) as decoded:
            actual_durations = []
            for frame_index in range(decoded.n_frames):
                decoded.seek(frame_index)
                decoded.load()
                actual_durations.append(decoded.info.get("duration", 0))
            metrics = {"width": decoded.width, "height": decoded.height, "frameCount": decoded.n_frames, "durationMs": sum(actual_durations), "loop": decoded.info.get("loop"), "bytes": gif_path.stat().st_size, "sceneDurationsMs": scene_durations}
        if actual_durations != durations or metrics["frameCount"] != planned_frames or metrics["durationMs"] != sum(scene_durations) or metrics["loop"] != 0:
            raise ValueError("GIF verification failed: encoded frames, duration or loop mismatch")
        (output / "metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        _check_output_size(output / "metrics.json")
        return metrics
    finally:
        overview.close()
        palette.close()
        for frame in frames:
            frame.close()


def main() -> int:
    try:
        payload = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
        if len(payload) > MAX_INPUT_BYTES:
            raise ValueError("request envelope exceeds 256 KiB; storyboard limit is 128 KiB")
        request = json.loads(payload)
        expected = {"storyboard", "outputDir", "theme"}
        if isinstance(request, dict) and "animationEngine" in request:
            expected.add("animationEngine")
        _keys(request, expected, "request")
        result = render_storyboard(request["storyboard"], request["outputDir"], request["theme"], request.get("animationEngine", "matplotlib"))
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
        return 0
    except (ValueError, OSError, ImportError, MemoryError) as error:
        message = str(error).replace("\n", " ")[:1400]
        print(f"renderer error: {message}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
