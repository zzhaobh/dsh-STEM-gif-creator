"""Contract tests run without Manim; native render is explicitly opt-in."""
import copy
import importlib
import json
import os
from pathlib import Path
import sys
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def fixture():
    return json.loads((ROOT / "examples" / "spark.json").read_text(encoding="utf-8"))


class SparkContractTests(unittest.TestCase):
    def setUp(self):
        self.backend = importlib.import_module("renderer.manim_backend")
        self.story = fixture()

    def test_golden_counts_and_packet_conservation(self):
        model = self.backend.build_spark_model(self.story)
        self.assertEqual(model.local_counts, ({"spark": 2, "data": 1}, {"ai": 1, "data": 1}))
        self.assertEqual(model.totals, {"ai": 1, "data": 2, "spark": 2})
        self.assertEqual(model.routing, {"ai": 0, "data": 1, "spark": 0})
        self.assertEqual(model.raw_count, 5)
        self.assertEqual(len(model.packets), 4)
        self.assertEqual(sum(packet.count for packet in model.packets), 5)
        for packet in model.packets:
            self.assertEqual(packet.destination, model.routing[packet.key])

    def test_cumulative_centisecond_timing(self):
        durations = self.backend.frame_durations(8)
        self.assertEqual(len(durations), 120)
        self.assertEqual(set(durations), {60, 70})
        self.assertEqual(sum(durations), 8000)
        self.assertEqual(sum(durations[90:]), 2000)

    def test_bounded_other_valid_partitions(self):
        self.story["scenes"][0]["technical"]["partitions"] = [["甲", "乙"] * 6, ["甲"] * 12]
        model = self.backend.build_spark_model(self.story)
        self.assertEqual(model.totals, {"乙": 6, "甲": 18})
        self.assertEqual(model.raw_count, 24)

    def test_unknown_fields_rejected_at_all_levels(self):
        for target in (self.story, self.story["scenes"][0], self.story["scenes"][0]["technical"]):
            target["python"] = "raise RuntimeError()"
            with self.assertRaises(ValueError):
                self.backend.validate_storyboard(self.story)
            del target["python"]

    def test_invalid_partitions_and_labels(self):
        invalid = [[], [["a"]], [["a"]] * 5, [["a"] * 13, ["b"]], [["a"] * 12] * 3,
                   [["a", "b", "c", "d", "e", "f", "g"], ["a"]],
                   [[""], ["a"]], [[" "], ["a"]], [["a" * 17], ["b"]],
                   [["a\u202eb"], ["a"]], [["a\n"], ["b"]], [[None], ["a"]],
                   ["abc", ["a"]], [[True], ["a"]]]
        for partitions in invalid:
            with self.subTest(partitions=partitions):
                self.story["scenes"][0]["technical"]["partitions"] = partitions
                with self.assertRaises(ValueError):
                    self.backend.validate_storyboard(self.story)

    def test_duration_hold_and_template_rejected(self):
        for value in [True, float("nan"), float("inf"), 4, 11, 8.5]:
            story = copy.deepcopy(self.story)
            story["scenes"][0]["durationSeconds"] = value
            with self.assertRaises(ValueError):
                self.backend.validate_storyboard(story)
        for value in [0, 3, True, float("nan")]:
            story = copy.deepcopy(self.story)
            story["scenes"][0]["technical"]["finalHoldSeconds"] = value
            with self.assertRaises(ValueError):
                self.backend.validate_storyboard(story)
        for field, value in [("template", "vla"), ("sketch", "yes")]:
            story = copy.deepcopy(self.story)
            story["scenes"][0]["technical"][field] = value
            with self.assertRaises(ValueError):
                self.backend.validate_storyboard(story)

    def test_one_scene_exact_source_and_empty_graph(self):
        for mutate in [lambda s: s["scenes"].append(copy.deepcopy(s["scenes"][0])),
                       lambda s: s["scenes"][0].update(evidence=["invented quote"]),
                       lambda s: s["scenes"][0].update(nodes=[{"id": "x"}]),
                       lambda s: s["scenes"][0].update(edges=[{"from": "x"}]),
                       lambda s: s["scenes"][0].update(id="../escape"),
                       lambda s: s["scenes"][0].update(layout="flow")]:
            story = copy.deepcopy(self.story)
            mutate(story)
            with self.assertRaises(ValueError):
                self.backend.validate_storyboard(story)

    def test_output_requires_empty_directory_without_symlinks(self):
        with tempfile.TemporaryDirectory(prefix="spark-test-") as scratch:
            root = Path(scratch).resolve()
            (root / "out").mkdir()
            out = self.backend.prepare_output_dir(root / "out")
            self.assertEqual(out, (root / "out").resolve())
            (out / "keep.txt").write_text("preserve", encoding="utf-8")
            with self.assertRaises(ValueError):
                self.backend.prepare_output_dir(out)
            self.assertEqual((out / "keep.txt").read_text(), "preserve")
            (root / "link").symlink_to(out, target_is_directory=True)
            for path in [root / "link", root / "link" / "child"]:
                with self.assertRaises(ValueError):
                    self.backend.prepare_output_dir(path)

    def test_no_manim_import_for_validation(self):
        result = subprocess.run([sys.executable, "-I", "-c",
            "import sys; sys.path.insert(0, sys.argv[1]); "
            "from renderer.manim_backend import validate_storyboard; "
            "import json; validate_storyboard(json.load(open(sys.argv[2]))); "
            "assert 'manim' not in sys.modules" , str(ROOT), str(ROOT / "examples" / "spark.json")],
            capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_cli_rejects_unknown_fields_and_bounded_envelope(self):
        for payload in ('{"storyboard":{},"outputDir":"x","theme":"light","code":"x"}', " " * (256 * 1024 + 1)):
            result = subprocess.run([sys.executable, "-I", str(ROOT / "renderer" / "manim_backend.py")],
                                    input=payload, text=True, capture_output=True, check=False)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(result.stdout, "")

    def test_unpainted_source_is_exact_and_has_no_literal_reference_requirement(self):
        self.story["source"] = "Synthetic\nexample\u200d, arbitrary authoritative reference."
        self.story["scenes"][0]["evidence"] = ["Synthetic\nexample\u200d"]
        self.assertIs(self.backend.validate_storyboard(self.story), self.story)
        self.assertEqual(self.story["scenes"][0]["evidence"][0], "Synthetic\nexample\u200d")
        self.story["scenes"][0]["title"] = "bad\u202etitle"
        with self.assertRaises(ValueError):
            self.backend.validate_storyboard(self.story)


@unittest.skipUnless(os.environ.get("MANIM_RENDER_TEST") == "1", "explicit native render integration")
class NativeRenderTests(unittest.TestCase):
    def test_actual_gif_timing_hold_palette_layout_and_glyphs(self):
        from renderer.manim_backend import render_storyboard
        from PIL import Image, ImageChops
        with tempfile.TemporaryDirectory(prefix="spark-render-test-") as scratch:
            output = Path(scratch).resolve() / "output"
            output.mkdir()
            metrics = render_storyboard(fixture(), output)
            self.assertEqual(set(p.name for p in output.iterdir()),
                             {"animation.gif", "scene-1.png", "overview.png", "metrics.json"})
            for field, value in [("durationMs", 8000), ("finalHoldMs", 2000),
                                 ("sourceFrameCount", 120), ("rawRecordCount", 5), ("shufflePacketCount", 4)]:
                self.assertEqual(metrics[field], value)
            self.assertEqual(metrics["totals"], {"spark": 2, "data": 2, "ai": 1})
            # Parse descriptors, not a byte-pattern heuristic: every image uses GCT.
            data = (output / "animation.gif").read_bytes()
            self.assertTrue(data[10] & 0x80)
            cursor = 13 + 3 * 2 ** ((data[10] & 7) + 1)
            descriptors = 0
            while data[cursor] != 0x3B:
                marker = data[cursor]
                cursor += 1
                if marker == 0x21:
                    cursor += 1
                else:
                    self.assertEqual(marker, 0x2C)
                    self.assertFalse(data[cursor + 8] & 0x80, "local palette found")
                    descriptors += 1
                    cursor += 10  # descriptor plus LZW minimum code size
                while data[cursor]:
                    cursor += data[cursor] + 1
                cursor += 1
            self.assertEqual(descriptors, metrics["frameCount"])
            self.assertTrue(metrics['font'], 'selected installed CJK font must be reported')
            with Image.open(output / "animation.gif") as gif:
                self.assertEqual(gif.size, (1280, 720))
                self.assertEqual(gif.info["loop"], 0)
                self.assertLessEqual(gif.n_frames, 150)
                frames, times = [], []
                for index in range(gif.n_frames):
                    gif.seek(index)
                    times.append(gif.info["duration"])
                    frames.append(gif.convert("RGB"))
                self.assertEqual(sum(times), 8000)
                self.assertEqual(times[-1], 2000)
                self.assertIsNotNone(ImageChops.difference(frames[0], frames[30]).getbbox())
                for box in [(0, 0, 1280, 100), (0, 650, 1280, 720)]:
                    # Lossless qtrle + a global palette: no tolerance conceals title motion.
                    for frame in frames:
                        with frames[0].crop(box) as first, frame.crop(box) as current:
                            with ImageChops.difference(first, current) as delta:
                                self.assertIsNone(delta.getbbox())
                for name in ("overview.png", "scene-1.png"):
                    with Image.open(output / name) as poster, poster.convert("RGB") as rgb:
                        with ImageChops.difference(rgb, frames[-1]) as delta:
                            self.assertIsNone(delta.getbbox())
                for frame in frames:
                    frame.close()
            self.assertLessEqual((output / "animation.gif").stat().st_size, 16 * 1024 * 1024)

    def test_fractional_and_endpoint_holds_keep_exact_source_frame_count(self):
        from renderer.manim_backend import render_storyboard
        from PIL import Image
        for hold in (1, 1.234, 1.999):
            with self.subTest(hold=hold), tempfile.TemporaryDirectory(prefix="spark-hold-test-") as scratch:
                output = Path(scratch).resolve() / "output"
                output.mkdir()
                story = fixture()
                story["scenes"][0]["technical"]["finalHoldSeconds"] = hold
                metrics = render_storyboard(story, output)
                self.assertEqual(metrics["sourceFrameCount"], 120)
                self.assertLessEqual(abs(metrics["finalHoldMs"] - hold * 1000), 5.001)
                with Image.open(output / "animation.gif") as gif:
                    times = []
                    for index in range(gif.n_frames):
                        gif.seek(index)
                        times.append(gif.info["duration"])
                    self.assertEqual(sum(times), 8000)
                    self.assertEqual(times[-1], round(hold * 100) * 10)

    def test_overflow_errors_instead_of_shrinking_and_leaves_no_outputs(self):
        from renderer.manim_backend import render_storyboard
        for partitions, title in [([["甲", "乙"] * 6, ["甲"] * 12], None),
                                  (None, "W" * 80),
                                  ([["abcdefghijklmnop"], ["b"]], None)]:
            with self.subTest(partitions=partitions, title=title), tempfile.TemporaryDirectory(prefix="spark-overflow-") as scratch:
                output = Path(scratch).resolve() / "output"
                output.mkdir()
                story = fixture()
                if partitions is not None:
                    story["scenes"][0]["technical"]["partitions"] = partitions
                if title is not None:
                    story["scenes"][0]["title"] = title
                with self.assertRaisesRegex(ValueError, "layout overflow"):
                    render_storyboard(story, output)
                self.assertEqual(list(output.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
