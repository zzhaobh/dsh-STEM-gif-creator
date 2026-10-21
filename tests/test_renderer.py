"""Behavioral tests for the fixed, local GIF renderer (run with unittest)."""

import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageChops

import renderer.render as renderer
from renderer.render import load_font, render_storyboard, validate_storyboard, wrap_text

ROOT = Path(__file__).resolve().parents[1]
SOURCE = "只有温度超过 80°C 才报警，低于阈值不报警；采样间隔为 2 秒。"


def scene(layout="flow", identifier="s1", duration=4):
    nodes = [
        {"id": "sample", "label": "温度采样", "detail": "每 2 秒读取一次"},
        {"id": "alarm", "label": "条件报警", "detail": "只有超过 80°C 才报警"},
    ]
    return {
        "id": identifier,
        "layout": layout,
        "title": "条件成立才执行",
        "summary": "低于阈值不报警；数字、单位和条件保持可见。",
        "durationSeconds": duration,
        "evidence": ["只有温度超过 80°C 才报警，低于阈值不报警"],
        "nodes": nodes,
        "edges": [] if layout == "compare" else [
            {"from": "sample", "to": "alarm", "label": "检查阈值"}
        ],
    }


def storyboard(*scenes):
    return {"title": "温度报警的条件与边界", "source": SOURCE, "scenes": list(scenes) or [scene()]}


def local_color_table_flags(data):
    """Read GIF structure so a per-frame palette regression is observable."""
    cursor = 13
    if data[10] & 0x80:
        cursor += 3 * (2 ** ((data[10] & 7) + 1))
    flags = []
    while data[cursor] != 0x3B:
        tag = data[cursor]
        cursor += 1
        if tag == 0x21:
            cursor += 1
        elif tag == 0x2C:
            packed = data[cursor + 8]
            flags.append(bool(packed & 0x80))
            cursor += 9
            if packed & 0x80:
                cursor += 3 * (2 ** ((packed & 7) + 1))
            cursor += 1
        else:
            raise AssertionError(f"Unexpected GIF tag {tag}")
        while data[cursor]:
            cursor += 1 + data[cursor]
        cursor += 1
    return flags


class ValidationTests(unittest.TestCase):
    def test_exact_source_excerpt_is_accepted_without_mutation(self):
        value = storyboard()
        original = copy.deepcopy(value)
        self.assertEqual(validate_storyboard(value), value)
        self.assertEqual(value, original)

    def test_untraceable_evidence_is_rejected(self):
        value = storyboard()
        value["scenes"][0]["evidence"] = ["达到 80°C 就报警"]
        with self.assertRaisesRegex(ValueError, "evidence"):
            validate_storyboard(value)

    def test_unknown_fields_are_rejected_at_each_level(self):
        for path in ((), ("scenes", 0), ("scenes", 0, "nodes", 0), ("scenes", 0, "edges", 0)):
            with self.subTest(path=path):
                value = storyboard()
                target = value
                for key in path:
                    target = target[key]
                target["script"] = "print('untrusted')"
                with self.assertRaisesRegex(ValueError, "unknown|field|keys"):
                    validate_storyboard(value)

    def test_duplicate_node_and_scene_ids_are_rejected(self):
        duplicate_node = storyboard()
        duplicate_node["scenes"][0]["nodes"][1]["id"] = "sample"
        duplicate_scene = storyboard(scene(), scene())
        for value in (duplicate_node, duplicate_scene):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "duplicate|unique"):
                validate_storyboard(value)

    def test_dangling_and_self_edges_are_rejected(self):
        for endpoint in ("missing", "sample"):
            value = storyboard()
            value["scenes"][0]["edges"][0]["to"] = endpoint
            with self.subTest(endpoint=endpoint), self.assertRaisesRegex(ValueError, "edge|endpoint|itself|self"):
                validate_storyboard(value)

    def test_hierarchy_cycles_are_rejected(self):
        value = storyboard(scene("hierarchy"))
        value["scenes"][0]["edges"].append({"from": "alarm", "to": "sample", "label": "循环"})
        with self.assertRaisesRegex(ValueError, "cycle|acyclic"):
            validate_storyboard(value)

    def test_comparison_requires_two_nodes_without_arrows(self):
        arrows = storyboard(scene("compare"))
        arrows["scenes"][0]["edges"] = [{"from": "sample", "to": "alarm", "label": "导致"}]
        extra = storyboard(scene("compare"))
        extra["scenes"][0]["nodes"].append({"id": "extra", "label": "第三组", "detail": "不合法"})
        for value in (arrows, extra):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "compare"):
                validate_storyboard(value)

    def test_scene_node_and_text_limits_are_enforced(self):
        values = []
        values.append(storyboard(*[scene(identifier=f"s{i}") for i in range(13)]))
        too_few = storyboard()
        too_few["scenes"][0]["nodes"] = too_few["scenes"][0]["nodes"][:1]
        values.append(too_few)
        too_many = storyboard()
        too_many["scenes"][0]["nodes"] = [
            {"id": f"n{i}", "label": "节点", "detail": "说明"} for i in range(7)
        ]
        values.append(too_many)
        too_long = storyboard()
        too_long["scenes"][0]["nodes"][0]["label"] = "过" * 200
        values.append(too_long)
        for value in values:
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_storyboard(value)

    def test_utf8_storyboard_budget_matches_host_contract(self):
        value = storyboard()
        value["source"] = "温" * 40000
        value["scenes"][0]["evidence"] = ["温" * 4000 for _ in range(8)]
        with self.assertRaisesRegex(ValueError, "128 KiB|131072"):
            validate_storyboard(value)

    def test_invalid_durations_layouts_and_control_text_are_rejected(self):
        for duration in (True, 0, -1, 2, 31, float("nan"), float("inf"), 100000):
            value = storyboard(scene(duration=duration))
            with self.subTest(duration=duration), self.assertRaisesRegex(ValueError, "duration"):
                validate_storyboard(value)
        for layout in ("python", "", None):
            with self.subTest(layout=layout), self.assertRaisesRegex(ValueError, "layout"):
                validate_storyboard(storyboard(scene(layout)))
        value = storyboard()
        value["scenes"][0]["summary"] = "隐藏\x00字符"
        with self.assertRaisesRegex(ValueError, "control|text|character"):
            validate_storyboard(value)


    def test_hierarchy_uses_topological_depth_and_supports_multiple_roots(self):
        item = scene("hierarchy")
        item["nodes"] = [
            {"id": "leaf", "label": "叶节点", "detail": "第三层"},
            {"id": "root-b", "label": "第二根", "detail": "独立根"},
            {"id": "middle", "label": "中间节点", "detail": "第二层"},
            {"id": "root", "label": "根节点", "detail": "第一层"},
        ]
        item["edges"] = [
            {"from": "root", "to": "middle", "label": "推进"},
            {"from": "middle", "to": "leaf", "label": "推进"},
        ]
        validate_storyboard(storyboard(item))
        depths, positions, order = renderer._hierarchy_geometry(item)
        self.assertEqual(depths, {"root": 0, "middle": 1, "leaf": 2, "root-b": 0})
        self.assertEqual(positions[1][0], positions[3][0])
        self.assertLess(positions[3][0], positions[2][0])
        self.assertGreater(positions[0][0], positions[2][0])
        self.assertEqual(set(order), {"root", "middle", "leaf", "root-b"})

    def test_edges_end_at_card_boundaries(self):
        start = (100, 100, 200, 100)
        end = (400, 200, 200, 100)
        a, b = renderer._edge_points(start, end)
        self.assertAlmostEqual(a[0], 300.0)
        self.assertAlmostEqual(a[1], 150 + 100 / 3)
        self.assertAlmostEqual(b[0], 400.0)
        self.assertAlmostEqual(b[1], 250 - 100 / 3)

    def test_source_and_evidence_preserve_format_controls(self):
        value = storyboard()
        value["source"] = "A\u200b " + SOURCE
        value["scenes"][0]["evidence"] = ["A\u200b " + SOURCE]
        self.assertIs(validate_storyboard(value), value)

    def test_unsafe_painted_controls_are_rejected(self):
        for field in ("title", "summary"):
            value = storyboard()
            value["scenes"][0][field] = "unsafe\u202e text"
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "control|format"):
                validate_storyboard(value)

    def test_chart_contract_is_strict_and_non_chart_disallows_chart(self):
        value = storyboard()
        item = value["scenes"][0]
        item.update(layout="chart", nodes=[], edges=[], chart={
            "type": "line", "xLabel": "时间", "yLabel": "温度", "yUnit": "°C",
            "baseline": 0, "categories": ["A", "B"],
            "series": [{"id": "measured", "label": "实测", "values": [1, 2]}],
        })
        self.assertIs(validate_storyboard(value), value)
        item["chart"]["series"][0]["values"] = [1]
        with self.assertRaisesRegex(ValueError, "chart|values"):
            validate_storyboard(value)
        item["chart"]["series"][0]["values"] = [1, 2]
        item["chart"]["extra"] = True
        with self.assertRaisesRegex(ValueError, "chart|field"):
            validate_storyboard(value)
        normal = storyboard()
        normal["scenes"][0]["chart"] = {}
        with self.assertRaisesRegex(ValueError, "chart|field"):
            validate_storyboard(normal)

    def test_chart_rejects_boolean_nan_negative_bar_and_bad_baseline(self):
        base = storyboard()
        base["scenes"][0].update(layout="chart", nodes=[], edges=[], chart={
            "type": "bar", "xLabel": "X", "yLabel": "Y", "yUnit": "",
            "baseline": 0, "categories": ["A", "B"],
            "series": [{"id": "s", "label": "Series", "values": [1, 2]}],
        })
        for edit in (
            lambda chart: chart["series"][0].update(values=[True, 2]),
            lambda chart: chart["series"][0].update(values=[float("nan"), 2]),
            lambda chart: chart.update(baseline=-1),
            lambda chart: chart.update(type="bar") or chart["series"][0].update(values=[-1, 2]),
        ):
            value = copy.deepcopy(base)
            edit(value["scenes"][0]["chart"])
            with self.assertRaisesRegex(ValueError, "chart|baseline|value"):
                validate_storyboard(value)

    def test_legacy_hierarchy_node_order_is_independent(self):
        item = scene("hierarchy")
        item["nodes"] = [item["nodes"][1], item["nodes"][0]]
        item["edges"] = [{"from": "sample", "to": "alarm", "label": "导致"}]
        depths, positions, _ = renderer._hierarchy_geometry(item)
        by_id = {node["id"]: positions[index] for index, node in enumerate(item["nodes"])}
        self.assertEqual(depths["sample"], 0)
        self.assertEqual(depths["alarm"], 1)
        self.assertLess(by_id["sample"][0], by_id["alarm"][0])

    def test_cli_payload_limit_is_storyboard_bound_not_envelope_bound(self):
        items = [scene(identifier=f"s{i}") for i in range(4)]
        for item in items:
            item["evidence"] = ["x" * 4000] * 8
            item["summary"] = "x" * 240
            item["nodes"] = [{"id": "n0", "label": "x" * 60, "detail": "x" * 240}, {"id": "n1", "label": "x" * 60, "detail": "x" * 240}]
            item["edges"] = [{"from": "n0", "to": "n1", "label": "x" * 60}]
        value = {"title": "x" * 80, "source": "x" * 40000, "scenes": items}
        with tempfile.TemporaryDirectory() as directory:
            payload = json.dumps({"storyboard": value, "outputDir": str(Path(directory) / "render"), "theme": "light"})
            result = subprocess.run(
                [sys.executable, str(ROOT / "renderer" / "render.py")], input=payload,
                text=True, capture_output=True, check=False, timeout=30,
            )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("128 KiB", result.stderr)

    def test_default_render_does_not_emit_unallowlisted_storyboard(self):
        with tempfile.TemporaryDirectory() as directory:
            render_storyboard(storyboard(), Path(directory), "light")
            self.assertEqual({path.name for path in Path(directory).iterdir()}, {
                "animation.gif", "overview.png", "scene-1.png", "metrics.json"
            })


class MeasuredTextTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.font = load_font(28)

    def test_chinese_wrap_uses_measured_width_and_preserves_words(self):
        lines = wrap_text("条件成立才执行", self.font, self.font.getlength("条件成立") + 1)
        self.assertEqual(lines, ["条件成立", "才执行"])
        self.assertTrue(all(self.font.getlength(line) <= 113 for line in lines))

    def test_mixed_text_and_explicit_lines_remain_complete(self):
        text = "只有温度超过 80°C 才报警\n低于阈值不报警，间隔为 2 秒。"
        lines = wrap_text(text, self.font, 240)
        self.assertEqual("".join(lines).replace(" ", ""), text.replace("\n", "").replace(" ", ""))
        self.assertTrue(all(self.font.getlength(line) <= 240 for line in lines))
        self.assertTrue(any("80°C" in line for line in lines))
        self.assertTrue(any("2 秒" in line for line in lines))

    def test_combining_characters_are_not_split_across_lines(self):
        lines = wrap_text("Cafe\u0301Cafe\u0301", self.font, self.font.getlength("Cafe\u0301") + 1)
        self.assertEqual(lines, ["Cafe\u0301", "Cafe\u0301"])
        self.assertTrue(all(not line.startswith("\u0301") for line in lines))

    def test_too_small_width_and_excess_lines_raise_loudly(self):
        with self.assertRaisesRegex(ValueError, "overflow|fit|width"):
            wrap_text("条件", self.font, 1)
        with self.assertRaisesRegex(ValueError, "overflow|lines|split"):
            wrap_text("条件成立才执行", self.font, 60, max_lines=2)

    def test_configured_missing_font_is_an_explicit_failure(self):
        with self.assertRaisesRegex(ValueError, "font|Font"):
            load_font(28, "/definitely/missing/font.ttf")


class RealMediaTests(unittest.TestCase):
    def test_all_four_layouts_produce_real_media_and_preserve_encoded_time(self):
        value = storyboard(
            scene("flow", "flow", 4),
            scene("cause", "cause", 5),
            scene("compare", "compare", 6),
            scene("hierarchy", "hierarchy", 7),
        )
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            metrics = render_storyboard(value, output, "light")
            self.assertEqual(metrics["width"], 1280)
            self.assertEqual(metrics["height"], 720)
            self.assertEqual(metrics["durationMs"], 22000)
            self.assertEqual(metrics["sceneDurationsMs"], [4000, 5000, 6000, 7000])
            self.assertEqual(metrics["loop"], 0)
            self.assertEqual(metrics["bytes"], (output / "animation.gif").stat().st_size)
            self.assertLess(metrics["bytes"], 20 * 1024 * 1024)
            self.assertEqual(json.loads((output / "metrics.json").read_text()), metrics)
            durations = []
            with Image.open(output / "animation.gif") as gif:
                self.assertEqual(gif.size, (1280, 720))
                self.assertEqual(gif.info["loop"], 0)
                self.assertEqual(gif.n_frames, metrics["frameCount"])
                self.assertGreaterEqual(gif.n_frames, 12)
                for frame in range(gif.n_frames):
                    gif.seek(frame)
                    durations.append(gif.info["duration"])
                self.assertEqual(sum(durations), 22000)
                self.assertGreaterEqual(durations[-1], 2000)
            self.assertEqual(local_color_table_flags((output / "animation.gif").read_bytes()), [False] * metrics["frameCount"])
            for index in range(1, 5):
                with Image.open(output / f"scene-{index}.png") as image:
                    self.assertEqual(image.size, (1280, 720))
                    self.assertGreater(len(image.convert("RGB").getcolors(200000) or []), 15)
            with Image.open(output / "overview.png") as overview:
                self.assertEqual(overview.size, (1280, 2880))
                with Image.open(output / "scene-1.png") as first:
                    self.assertIsNone(ImageChops.difference(overview.crop((0, 0, 1280, 720)).convert("RGB"), first.convert("RGB")).getbbox())

    def test_six_nodes_and_all_explicit_relationships_fit_each_graph_layout(self):
        scenes = []
        for layout in ("flow", "cause", "hierarchy"):
            item = scene(layout, layout)
            item["nodes"] = [{"id": f"n{i}", "label": f"步骤 {i + 1}", "detail": "条件成立才继续"} for i in range(6)]
            item["edges"] = [{"from": f"n{i}", "to": f"n{i + 1}", "label": "满足条件"} for i in range(5)]
            scenes.append(item)
        with tempfile.TemporaryDirectory() as directory:
            metrics = render_storyboard(storyboard(*scenes), Path(directory), "dark")
            self.assertEqual(metrics["durationMs"], 12000)
            self.assertGreaterEqual(metrics["frameCount"], 21)

    def test_layout_choice_changes_graph_geometry(self):
        images = {}
        with tempfile.TemporaryDirectory() as directory:
            for layout in ("flow", "cause", "hierarchy"):
                output = Path(directory) / layout
                item = scene(layout)
                item["nodes"].append({"id": "result", "label": "最后结果", "detail": "保留条件"})
                item["edges"].append({"from": "alarm", "to": "result", "label": "执行"})
                render_storyboard(storyboard(item), output, "light")
                with Image.open(output / "scene-1.png") as image:
                    images[layout] = image.convert("RGB")
            self.assertIsNotNone(ImageChops.difference(images["flow"], images["cause"]).getbbox())
            self.assertIsNotNone(ImageChops.difference(images["flow"], images["hierarchy"]).getbbox())
            self.assertIsNotNone(ImageChops.difference(images["cause"], images["hierarchy"]).getbbox())
        for image in images.values():
            image.close()

    def test_text_overflow_fails_before_any_finished_media_exists(self):
        item = scene()
        item["nodes"][0]["detail"] = "宽" * 120
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "overflow|split|fit"):
                render_storyboard(storyboard(item), Path(directory), "light")
            self.assertFalse((Path(directory) / "animation.gif").exists())

    def test_invalid_theme_output_path_and_noninteger_duration_fail(self):
        for theme in ("auto", {}, "../dark"):
            with tempfile.TemporaryDirectory() as directory, self.subTest(theme=theme), self.assertRaisesRegex(ValueError, "theme"):
                render_storyboard(storyboard(), Path(directory), theme)
        for directory in ("", "/", "relative/output", "bad\x00path"):
            with self.subTest(directory=directory), self.assertRaisesRegex(ValueError, "output|path|absolute"):
                render_storyboard(storyboard(), directory, "light")
        with self.assertRaisesRegex(ValueError, "duration"):
            validate_storyboard(storyboard(scene(duration=3.211)))

    def test_output_path_cannot_escape_through_an_intermediate_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            real = root / "actual"
            real.mkdir()
            link = root / "linked"
            link.symlink_to(real, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, "symlink|symbolic"):
                render_storyboard(storyboard(), link / "child", "light")

    def test_cli_emits_only_bounded_metrics_json_on_success(self):
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(
                [sys.executable, str(ROOT / "renderer" / "render.py")],
                input=json.dumps({"storyboard": storyboard(), "outputDir": directory, "theme": "dark"}),
                text=True, capture_output=True, check=False, timeout=60,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stderr, "")
            self.assertLess(len(result.stdout.encode()), 8192)
            metrics = json.loads(result.stdout)
            self.assertEqual(metrics["durationMs"], 4000)
            self.assertEqual(metrics["width"], 1280)

    def test_cli_rejects_invalid_json_unknown_fields_and_oversized_input(self):
        cases = [
            "{not json}",
            json.dumps({"storyboard": storyboard(), "outputDir": "/tmp/ignored", "theme": "light", "code": "print(1)"}),
            " " * (256 * 1024 + 1),
        ]
        for payload in cases:
            with self.subTest(size=len(payload)):
                result = subprocess.run(
                    [sys.executable, str(ROOT / "renderer" / "render.py")],
                    input=payload, text=True, capture_output=True, check=False, timeout=30,
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "")
                self.assertLess(len(result.stderr.encode()), 2048)
                self.assertIn("error", result.stderr.lower())


def chart_scene(chart_type="line", duration=5, count=4):
    item = scene()
    item.update(layout="chart", nodes=[], edges=[], durationSeconds=duration, chart={
        "type": chart_type, "xLabel": "Month", "yLabel": "Revenue", "yUnit": "USD",
        "baseline": 0, "categories": [f"M{i + 1}" for i in range(count)],
        "series": [
            {"id": "sales", "label": "Sales", "values": [10 + i * 2 for i in range(count)]},
            {"id": "target", "label": "Target", "values": [12 + i for i in range(count)]},
        ],
    })
    return item


class ChartTests(unittest.TestCase):
    def test_line_and_bar_chart_real_media_on_both_engines(self):
        for kind in ("line", "bar"):
            final_images = []
            for engine in ("matplotlib", "celluloid"):
                with self.subTest(kind=kind, engine=engine), tempfile.TemporaryDirectory() as directory:
                    value = storyboard(chart_scene(kind, 6))
                    metrics = render_storyboard(value, Path(directory), "light", engine)
                    self.assertEqual(metrics["frameCount"], 5)
                    self.assertEqual(metrics["durationMs"], 6000)
                    self.assertEqual(metrics["sceneDurationsMs"], [6000])
                    path = Path(directory)
                    with Image.open(path / "animation.gif") as image:
                        self.assertEqual(image.n_frames, 5)
                        self.assertEqual(image.info["loop"], 0)
                        durations = []
                        for frame in range(image.n_frames):
                            image.seek(frame)
                            image.load()
                            durations.append(image.info["duration"])
                        self.assertEqual(durations, [100, 100, 100, 100, 5600])
                    with Image.open(path / "scene-1.png") as image:
                        final_images.append(image.copy())
                    self.assertEqual(local_color_table_flags((path / "animation.gif").read_bytes()), [False] * 5)
                    self.assertTrue(all(p.stat().st_size <= 16 * 1024 * 1024 for p in path.iterdir()))
                    self.assertEqual({p.name for p in path.iterdir()}, {"animation.gif", "overview.png", "scene-1.png", "metrics.json"})
            self.assertIsNone(ImageChops.difference(*final_images).getbbox())
            for image in final_images:
                image.close()

    def test_maximum_categories_have_thirteen_frames_with_canonical_duration(self):
        for engine in ("matplotlib", "celluloid"):
            with self.subTest(engine=engine), tempfile.TemporaryDirectory() as directory:
                metrics = render_storyboard(storyboard(chart_scene(count=12, duration=3)), Path(directory), animation_engine=engine)
                self.assertEqual(metrics["frameCount"], 13)
                self.assertEqual(metrics["durationMs"], 3000)

    def test_fixed_axis_limits_and_observed_values_for_every_snapshot(self):
        from matplotlib.axes import Axes
        observed = []
        limits = []
        original_plot = Axes.plot
        def plot(axes, x, y, *args, **kwargs):
            observed.append((list(x), list(y)))
            limits.append((axes.get_xlim(), axes.get_ylim()))
            return original_plot(axes, x, y, *args, **kwargs)
        for engine in ("matplotlib", "celluloid"):
            observed.clear()
            limits.clear()
            with tempfile.TemporaryDirectory() as directory, patch.object(Axes, "plot", plot):
                render_storyboard(storyboard(chart_scene()), Path(directory), animation_engine=engine)
            self.assertEqual(len(observed), 10)
            for revealed in range(5):
                self.assertEqual(observed[revealed * 2], (list(range(revealed)), [10 + i * 2 for i in range(revealed)]))
            self.assertEqual(len(set(limits)), 1)
            self.assertEqual(limits[0][1][0], 0)
            self.assertGreater(limits[0][1][1], 16)

    def test_celluloid_camera_snapshots_are_really_called(self):
        from celluloid import Camera
        photos = []
        original_snap = Camera.snap
        def snap(camera):
            photo = original_snap(camera)
            photos.append(photo)
            return photo
        with tempfile.TemporaryDirectory() as directory, patch.object(Camera, "snap", snap):
            render_storyboard(storyboard(chart_scene()), Path(directory), animation_engine="celluloid")
        self.assertEqual(len(photos), 5)
        self.assertTrue(all(photo for photo in photos))

    def test_celluloid_engine_fails_clearly_without_fallback(self):
        import builtins
        real_import = builtins.__import__
        def missing_celluloid(name, *args, **kwargs):
            if name == "celluloid":
                raise ImportError("missing by test")
            return real_import(name, *args, **kwargs)
        with tempfile.TemporaryDirectory() as directory, patch("builtins.__import__", side_effect=missing_celluloid), self.assertRaisesRegex(ValueError, "celluloid.*unavailable"):
            render_storyboard(storyboard(chart_scene()), Path(directory), animation_engine="celluloid")

    def test_chart_strict_boundary_values_and_unknown_keys(self):
        mutations = [
            lambda c: c.update(type="scatter"),
            lambda c: c.update(baseline=True),
            lambda c: c.update(baseline=float("inf")),
            lambda c: c.update(categories=["same", "same"]),
            lambda c: c.update(categories=["only"]),
            lambda c: c.update(categories=[" " for _ in range(4)]),
            lambda c: c.update(series=[]),
            lambda c: c["series"][0].update(values=[1, 2, 3]),
            lambda c: c["series"][0].update(values=[1e12 + 1] * 4),
            lambda c: c["series"][0].update(values=["2"] * 4),
            lambda c: c["series"][0].update(values=[None] * 4),
            lambda c: c["series"][0].update(values=[-1] * 4),
            lambda c: c["series"][1].update(id="sales"),
            lambda c: c["series"][0].update(code="malicious"),
            lambda c: c.update(extra=1),
            lambda c: c.update(xLabel="x\u202e"),
        ]
        for mutate in mutations:
            value = storyboard(chart_scene())
            mutate(value["scenes"][0]["chart"])
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                validate_storyboard(value)
        value = storyboard(chart_scene())
        value["scenes"][0]["chart"].update(baseline=-1e12)
        value["scenes"][0]["chart"]["series"][0]["values"] = [-1e12, 0, 1, 1e12]
        self.assertIs(validate_storyboard(value), value)

    def test_cli_optional_engine_and_invalid_engine(self):
        for engine in ("matplotlib", "celluloid", "unknown"):
            with tempfile.TemporaryDirectory() as directory:
                result = subprocess.run([sys.executable, str(ROOT / "renderer" / "render.py")],
                    input=json.dumps({"storyboard": storyboard(chart_scene()), "outputDir": directory,
                        "theme": "dark", "animationEngine": engine}), text=True, capture_output=True, check=False, timeout=60)
                if engine == "unknown":
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("animationEngine", result.stderr)
                else:
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(json.loads(result.stdout)["frameCount"], 5)

    def test_png_and_overview_byte_limits_are_enforced(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(renderer, "MAX_OUTPUT_BYTES", 100), self.assertRaisesRegex(ValueError, "scene-1.png.*16 MiB"):
            render_storyboard(storyboard(), Path(directory))


class VisualBoundsRegression(unittest.TestCase):
    def test_compact_node_title_starts_below_number_badge(self):
        prepared = renderer._prepare(storyboard(scene('cause')), renderer.THEMES['light'], renderer._font_path())
        for item in prepared:
            for position, text in zip(item['positions'], item['nodes']):
                self.assertGreaterEqual(text[0]['y'], position[1] + 39)


if __name__ == "__main__":
    unittest.main()
