import unittest
from sequences import clamp

class AcceptanceTests(unittest.TestCase):
    def test_acceptance(self):
        self.assertEqual(clamp(-2, 0, 10), 0)
        self.assertEqual(clamp(12, 0, 10), 10)
        self.assertEqual(clamp(1.5, 1, 2), 1.5)
        self.assertEqual(clamp(2, 2, 2), 2)
        with self.assertRaises(ValueError):
            clamp(2, 5, 1)
