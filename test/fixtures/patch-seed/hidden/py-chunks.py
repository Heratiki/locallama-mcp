import unittest
from sequences import chunked

class AcceptanceTests(unittest.TestCase):
    def test_acceptance(self):
        values = [1, 2, 3, 4, 5]
        self.assertEqual(chunked(values, 2), [[1, 2], [3, 4], [5]])
        self.assertEqual(values, [1, 2, 3, 4, 5])
        self.assertEqual(chunked([], 3), [])
        with self.assertRaises(ValueError):
            chunked(values, 0)
        with self.assertRaises(ValueError):
            chunked(values, -1)
