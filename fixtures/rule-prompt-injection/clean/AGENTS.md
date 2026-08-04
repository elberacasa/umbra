# Agent notes

Never weaken a rule to make a test pass. Fix the code or the fixture.

The guard blocks dangerous writes before they land. When a write is refused,
fix the root cause named in the reason and write again.
