"""Course self-checks. --reference checks analyze.py, not a student's work."""
import importlib
import math
import sys
import tempfile
import unittest
from pathlib import Path
from analyze import load_log

TOLERANCE = 0.001
USE_REFERENCE = "--reference" in sys.argv
if USE_REFERENCE:
    sys.argv.remove("--reference")
summarize = importlib.import_module("analyze" if USE_REFERENCE else "exercise").summarize
DATA = Path(__file__).parent / "data"


def within_tolerance(actual, expected):
    """Absolute tolerance; tiny floating-point slack only at the boundary."""
    if isinstance(actual, bool) or not isinstance(actual, (int, float)):
        return False
    if not math.isfinite(actual):
        return False
    slack = 4 * math.ulp(max(abs(float(actual)), abs(float(expected)), 1.0))
    return abs(actual - expected) <= TOLERANCE + slack


def row(time, x, y=0, battery=90):
    return {"time": time, "x": x, "y": y, "yaw": 0, "battery": battery}


class LessonChecks(unittest.TestCase):
    def metric(self, actual, expected):
        self.assertTrue(within_tolerance(actual, expected),
                        f"实际 {actual!r}，预期 {expected!r}；绝对误差应不超过 {TOLERANCE}")

    def segments(self, actual, expected):
        self.assertIsInstance(actual, list)
        self.assertEqual(len(actual), len(expected))
        for received, reference in zip(actual, expected):
            self.assertEqual(set(received), {"start", "end", "speed"})
            for key in ("start", "end", "speed"):
                self.metric(received[key], reference[key])

    def test_01_square(self):
        result = summarize(load_log(DATA / "motion_log.csv"))
        self.assertIs(type(result["samples"]), int)
        self.assertEqual(result["samples"], 21)
        for key, expected in {"duration_s": 20, "distance_m": 10,
                              "mean_speed_mps": 0.5, "max_speed_mps": 0.5,
                              "displacement_m": 0, "battery_drop_pp": 5}.items():
            self.metric(result[key], expected)
        self.segments(result["suspicious"], [])

    def test_02_diagonal(self):
        result = summarize([row(0, 0), row(2, 3, 4, 89)])
        self.metric(result["distance_m"], 5)
        self.metric(result["mean_speed_mps"], 2.5)
        self.metric(result["battery_drop_pp"], 1)

    def test_03_stationary(self):
        result = summarize([row(0, 2, 3), row(5, 2, 3)])
        self.metric(result["distance_m"], 0)
        self.metric(result["max_speed_mps"], 0)
        self.segments(result["suspicious"], [])

    def test_04_irregular_sampling(self):
        result = summarize([row(0, 0), row(1, 1), row(4, 2)])
        self.metric(result["mean_speed_mps"], 0.5)
        self.metric(result["duration_s"], 4)

    def test_05_position_jump(self):
        result = summarize(load_log(DATA / "position_jump.csv"))
        self.metric(result["distance_m"], 11)
        self.segments(result["suspicious"], [{"start": 1, "end": 2, "speed": 10}])

    def test_06_invalid_threshold(self):
        for value in (0, -1, float("nan"), float("inf")):
            with self.subTest(value=value), self.assertRaises(ValueError):
                summarize([row(0, 0), row(1, 1)], value)

    def test_07_bad_time_and_short_log(self):
        for body in ("time,x,y,yaw,battery\n0,0,0,0,90\n0,1,0,0,89\n",
                     "time,x,y,yaw,battery\n0,0,0,0,90\n",
                     "time,x,y,yaw,battery\n2,0,0,0,90\n1,1,0,0,89\n"):
            self.check_invalid(body)

    def test_08_bad_fields(self):
        for body in ("time,x,y\n0,0,0\n1,1,0\n",
                     "time,x,y,yaw,battery\n0,0,0,0,90\n1,nan,0,0,89\n",
                     "time,x,y,yaw,battery\n0,0,0,0,101\n1,1,0,0,90\n",
                     "time,x,y,yaw,battery\n0,0,0,0,90\n1,,0,0,89\n"):
            self.check_invalid(body)

    def test_09_lower_custom_threshold(self):
        self.segments(summarize([row(0, 0), row(1, 1)], 0.5)["suspicious"],
                      [{"start": 0, "end": 1, "speed": 1}])

    def test_10_higher_custom_threshold(self):
        self.segments(summarize(load_log(DATA / "position_jump.csv"), 20)["suspicious"], [])

    def test_11_equal_threshold_is_not_suspicious(self):
        for threshold in (0.5, 1.5, 2.5):
            with self.subTest(threshold=threshold):
                self.segments(summarize([row(0, 0), row(1, threshold)], threshold)["suspicious"], [])

    def test_12_multiple_segments_in_order(self):
        result = summarize([row(0, 0), row(1, 2), row(2, 2.5), row(3, 5.5)], 1)
        self.segments(result["suspicious"], [
            {"start": 0, "end": 1, "speed": 2}, {"start": 2, "end": 3, "speed": 3}])

    def test_13_nonzero_start_time(self):
        result = summarize([row(10, 0), row(12, 3, 4)])
        self.metric(result["duration_s"], 2)
        self.metric(result["mean_speed_mps"], 2.5)

    def test_14_irregular_segment_speeds(self):
        result = summarize([row(0, 0), row(1, 2), row(5, 6)], 1.5)
        self.metric(result["max_speed_mps"], 2)
        self.metric(result["mean_speed_mps"], 1.2)
        self.segments(result["suspicious"], [{"start": 0, "end": 1, "speed": 2}])

    def check_invalid(self, body):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "invalid.csv"
            path.write_text(body, encoding="utf-8")
            with self.assertRaises(ValueError):
                load_log(path)


if __name__ == "__main__":
    print("检查对象：{}；数值绝对误差 ≤ 0.001；通过自检不等于教师审核通过。".format(
        "参考程序" if USE_REFERENCE else "我的练习"))
    unittest.main(verbosity=2)
