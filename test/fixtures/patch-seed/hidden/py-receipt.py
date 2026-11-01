import unittest
from price import format_cents
from receipt import receipt

class AcceptanceTests(unittest.TestCase):
    def test_acceptance(self):
        self.assertEqual(format_cents(5), "0.05")
        self.assertEqual(format_cents(-105), "-1.05")
        self.assertEqual(format_cents(200), "2.00")
        self.assertEqual(receipt(" Tea ", -125), "Tea: $-1.25")
