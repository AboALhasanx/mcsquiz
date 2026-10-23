# Roadmap

Ideas that are recorded on purpose. Nothing here is promised for a date — the
rule is that a feature is only built when the student asks for it.

## Next

### All-time numbers + streak on the player card

The card shipped with this week's figures only, because `league_xp` is one row per
week and the per-question history is encrypted on the device (the server cannot
read it). All-time answers, average score and a streak need an **aggregate column**
written on every finished quiz (e.g. `portal_users.total_answered`, `total_xp`,
`last_played_on`, `streak_days`) and one RPC that returns them. Nothing about the
card's design changes — it just gets a second line of numbers.

## Later

- **Streak** (أيام متتالية): count consecutive days with at least one finished
  quiz; show it on the card and in the league row.
- **Subject badges**: a small mark on the row when a player passes 80% in a
  subject's chapter set.
- **Share my card as an image**: reuse the league share-card canvas for one
  player instead of the whole board.
- **Class group code**: join a specific class (e.g. `CS-2026-A`) so the league
  can be filtered to classmates only.

## Done

- **2026-10-23** — **public player card v1** (1.7.0): every league row and podium
  slot opens a sheet with the avatar, name, rank, answers, accuracy and the top
  three subjects **for this week**, plus a note that it is weekly. No handle, no
  PIN, no history; the `hidden` rule is inherited from the board. Client-only —
  the board already carried the fields, so no RPC and no schema change. Spec:
  `tests/test_player_card.py` (11 checks).
- **2026-10-23** — the league card no longer mentions the Telegram bot (which
  the app dropped); it says «سجّل حسابك» and opens the sign-up sheet.
