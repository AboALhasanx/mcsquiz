# Roadmap

Ideas that are recorded on purpose. Nothing here is promised for a date — the
rule is that a feature is only built when the student asks for it.

## Next

### Public player card (بطاقة اللاعب العامة)

**Idea.** In the weekly league, a row is currently just a name and a number.
Tapping a row should open a small sheet about that classmate: what they are good
at, how active they are, and nothing private.

**What it would show**

| Field | Where it comes from |
|---|---|
| avatar + display name | `league_xp.avatar` / `name` |
| rank this week, answers, accuracy | the board row (already computed) |
| best subjects (top 2–3 by answers) | `league_xp.per_subject` |
| all-time answers and average score | the player's own aggregate, if the account allows it |
| movement this week (▲▼) | rank delta against the previous snapshot |

**Rules that make it safe**

- Only aggregates: no handle, no PIN, no bookmarks, no question-level history.
- A player marked `hidden` is shown as «مخفي» and their card stays empty —
  the same rule the board already follows.
- Opt-out switch on the account page («إظهار بطاقتي للزملاء»), on by default
  only if the student wants it; the board keeps working either way.
- The card is read-only: no messaging, no following, no notifications.

**Why it is worth it.** The league answers "who is first"; a card answers "who
is good at what", which is the part classmates actually talk about. It also
gives the profile page a natural place to grow into.

**Cost.** One RPC (`player_card(handle_or_id)` returning aggregates), one sheet
in the shell, ~120 lines and a spec.

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

- **2026-10-23** — the league card no longer mentions the Telegram bot (which
  the app dropped); it says «سجّل حسابك» and opens the sign-up sheet.
