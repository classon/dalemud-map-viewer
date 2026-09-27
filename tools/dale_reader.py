"""Stream reader that mimics the C fread_string() and fscanf() calls in src/db.c."""

import re


class Reader:
    """Stream reader that mimics fread_string() and fscanf(" %ld ")."""

    _ws = re.compile(r"\s*")
    _token = re.compile(r"\S+")

    def __init__(self, text):
        self.text = text
        self.pos = 0

    def skip_ws(self):
        self.pos = self._ws.match(self.text, self.pos).end()

    def at_end(self):
        self.skip_ws()
        return self.pos >= len(self.text)

    def peek_token(self):
        self.skip_ws()
        m = self._token.match(self.text, self.pos)
        return m.group(0) if m else None

    def token(self):
        self.skip_ws()
        m = self._token.match(self.text, self.pos)
        if not m:
            raise EOFError("unexpected end of file")
        self.pos = m.end()
        return m.group(0)

    def int(self):
        tok = self.token()
        try:
            return int(tok)
        except ValueError:
            raise ValueError(f"expected integer, got {tok!r} near offset {self.pos}")

    def optional_int(self):
        """Like fscanf("%ld"): on a non-number, consume nothing and return None."""
        tok = self.peek_token()
        if tok is None or not re.fullmatch(r"-?\d+", tok):
            return None
        return self.int()

    def string(self):
        """Read up to the next '~' and discard the rest of that line."""
        end = self.text.find("~", self.pos)
        if end < 0:
            raise EOFError("unterminated string")
        value = self.text[self.pos:end]
        nl = self.text.find("\n", end)
        self.pos = len(self.text) if nl < 0 else nl + 1
        return value.replace("\r", "").rstrip()
