import unittest
from text import unique_words, camel_to_snake
from sequences import clamp, chunked
from price import format_cents
from receipt import receipt


class BasicTests(unittest.TestCase):
    def test_text(self):
        self.assertEqual(unique_words("one two"), ["one", "two"])
        self.assertEqual(camel_to_snake("word"), "word")

    def test_sequences(self):
        self.assertEqual(clamp(4, 1, 8), 4)
        self.assertEqual(chunked([1, 2], 3), [[1, 2]])

    def test_receipt(self):
        self.assertEqual(float(format_cents(200)), 2)
        self.assertTrue(receipt("Tea", 200).startswith("Tea: "))
