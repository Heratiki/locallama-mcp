from price import format_cents


def receipt(label, cents):
    return f"{label}: {format_cents(cents)}"
