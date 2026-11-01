import unittest
from text import unique_words

class AcceptanceTests(unittest.TestCase):
    def test_acceptance(self):
        self.assertEqual(unique_words("One TWO one two Three"), ["one", "two", "three"])
        self.assertEqual(unique_words("  "), [])
        self.assertEqual(unique_words("A! a! A"), ["a!", "a"])
