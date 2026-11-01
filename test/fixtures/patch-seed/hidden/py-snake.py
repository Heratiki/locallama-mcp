import unittest
from text import camel_to_snake

class AcceptanceTests(unittest.TestCase):
    def test_acceptance(self):
        self.assertEqual(camel_to_snake("helloWorld"), "hello_world")
        self.assertEqual(camel_to_snake("HTTPServer"), "http_server")
        self.assertEqual(camel_to_snake("already_snake"), "already_snake")
        self.assertEqual(camel_to_snake(""), "")
