#!/usr/bin/env python3
"""Generate Diamond Draft's offline beta cards from the SABR/Lahman database.

Usage:
  PYTHONPATH=/path/to/rdata-and-pandas python3 scripts/generate_beta_data.py \
    --lahman-dir /path/to/Lahman/data

The checked-in TypeScript output is the runtime source of truth; gameplay never
fetches an external API. OPS+/ERA+ and WAR are transparent beta estimates made
from the franchise/decade-only Lahman totals because Lahman does not publish WAR.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd
import rdata


DECADES = {
    "1980s": range(1980, 1990),
    "1990s": range(1990, 2000),
    "2000s": range(2000, 2010),
    "2010s": range(2010, 2020),
}

FRANCHISES = [
    ("yankees", "NYY", "Yankees", ["NYA"]),
    ("red-sox", "BOS", "Red Sox", ["BOS"]),
    ("dodgers", "LAD", "Dodgers", ["LAN"]),
    ("giants", "SFG", "Giants", ["SFN"]),
    ("cardinals", "STL", "Cardinals", ["SLN"]),
    ("cubs", "CHC", "Cubs", ["CHN"]),
    ("braves", "ATL", "Braves", ["ATL"]),
    ("mariners", "SEA", "Mariners", ["SEA"]),
    ("orioles", "BAL", "Orioles", ["BAL"]),
    ("athletics", "OAK", "Athletics", ["OAK"]),
    ("angels", "LAA", "Angels", ["CAL", "ANA", "LAA"]),
    ("phillies", "PHI", "Phillies", ["PHI"]),
]

FIELD_POSITIONS = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"]
ALL_CARD_POSITIONS = FIELD_POSITIONS + ["SP", "RP"]


def frame(data_dir: Path, name: str) -> pd.DataFrame:
    return rdata.read_rda(str(data_dir / f"{name}.RData"))[name]


def number(value, default=0.0) -> float:
    return default if pd.isna(value) else float(value)


def rounded(value: float, digits=1) -> float:
    return round(float(value), digits)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lahman-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("src/data/mlb/betaPlayers.json"))
    args = parser.parse_args()

    batting = frame(args.lahman_dir, "Batting")
    pitching = frame(args.lahman_dir, "Pitching")
    fielding = frame(args.lahman_dir, "Fielding")
    outfield = frame(args.lahman_dir, "FieldingOFsplit")
    people = frame(args.lahman_dir, "People")

    names = {
        row.playerID: " ".join(part for part in [str(row.nameFirst or ""), str(row.nameLast or "")] if part and part != "<NA>")
        for row in people.itertuples()
    }

    cards: list[dict] = []
    combinations: list[dict] = []

    for franchise_id, abbreviation, team_name, team_ids in FRANCHISES:
        for decade, years in DECADES.items():
            years_set = set(years)
            combinations.append({
                "id": f"{franchise_id}-{decade}",
                "franchiseId": franchise_id,
                "team": abbreviation,
                "teamName": team_name,
                "decade": decade,
            })

            b = batting[batting.yearID.isin(years_set) & batting.teamID.isin(team_ids)].copy()
            p = pitching[pitching.yearID.isin(years_set) & pitching.teamID.isin(team_ids)].copy()
            f = fielding[fielding.yearID.isin(years_set) & fielding.teamID.isin(team_ids)].copy()
            ofs = outfield[outfield.yearID.isin(years_set) & outfield.teamID.isin(team_ids)].copy()

            # Decade league environments make the plus metrics era-aware.
            leagues = set(b.lgID.dropna().astype(str))
            league_b = batting[batting.yearID.isin(years_set) & batting.lgID.isin(leagues)]
            lab = number(league_b.AB.sum())
            lh = number(league_b.H.sum())
            lbb = number(league_b.BB.sum())
            lhbp = number(league_b.HBP.sum())
            lsf = number(league_b.SF.sum())
            l2b = number(league_b.X2B.sum())
            l3b = number(league_b.X3B.sum())
            lhr = number(league_b.HR.sum())
            league_obp = (lh + lbb + lhbp) / max(1, lab + lbb + lhbp + lsf)
            league_slg = (lh + l2b + 2 * l3b + 3 * lhr) / max(1, lab)
            league_ops = league_obp + league_slg

            league_p = pitching[pitching.yearID.isin(years_set) & pitching.lgID.isin(leagues)]
            league_era = 27 * number(league_p.ER.sum()) / max(1, number(league_p.IPouts.sum()))

            position_games: dict[str, dict[str, float]] = {}
            for row in f.groupby(["playerID", "POS"], as_index=False).G.sum().itertuples():
                if row.POS in FIELD_POSITIONS[:5]:
                    position_games.setdefault(str(row.playerID), {})[str(row.POS)] = number(row.G)
            for row in ofs.groupby(["playerID", "POS"], as_index=False).G.sum().itertuples():
                if row.POS in FIELD_POSITIONS[5:]:
                    position_games.setdefault(str(row.playerID), {})[str(row.POS)] = number(row.G)

            hitter_candidates: dict[str, dict] = {}
            for player_id, rows in b.groupby("playerID"):
                ab = number(rows.AB.sum())
                hits = number(rows.H.sum())
                walks = number(rows.BB.sum())
                hbp = number(rows.HBP.sum())
                sf = number(rows.SF.sum())
                doubles = number(rows.X2B.sum())
                triples = number(rows.X3B.sum())
                homers = number(rows.HR.sum())
                rbi = number(rows.RBI.sum())
                games = number(rows.G.sum())
                pa = ab + walks + hbp + sf
                if pa < 80:
                    continue
                avg = hits / max(1, ab)
                obp = (hits + walks + hbp) / max(1, ab + walks + hbp + sf)
                slg = (hits + doubles + 2 * triples + 3 * homers) / max(1, ab)
                ops_plus = round(100 * (obp + slg) / max(.001, league_ops))
                games_by_position = position_games.get(str(player_id), {})
                most_games = max(games_by_position.values(), default=0)
                eligible = [pos for pos in FIELD_POSITIONS if games_by_position.get(pos, 0) >= max(10, most_games * .10)]
                if not eligible:
                    continue
                sb = number(rows.SB.sum())
                cs = number(rows.CS.sum())
                field_rows = f[f.playerID == player_id]
                chances = number(field_rows.PO.sum()) + number(field_rows.A.sum()) + number(field_rows.E.sum())
                field_pct = (number(field_rows.PO.sum()) + number(field_rows.A.sum())) / max(1, chances)
                war = max(-5, (pa / 600) * ((ops_plus - 78) / 10) + (field_pct - .965) * games * .12)
                hitter_candidates[str(player_id)] = {
                    "id": f"{franchise_id}-{decade}-{player_id}",
                    "playerId": str(player_id),
                    "name": names.get(str(player_id), str(player_id)),
                    "franchiseId": franchise_id,
                    "team": abbreviation,
                    "decade": decade,
                    "eligiblePositions": eligible,
                    "type": "hitter",
                    "isTwoWay": False,
                    "stats": {
                        "war": rounded(war), "opsPlus": ops_plus, "hr": int(homers), "avg": rounded(avg, 3),
                        "obp": rounded(obp, 3), "slg": rounded(slg, 3), "rbi": int(rbi), "sb": int(sb),
                    },
                    "scoringStats": {
                        "obp": rounded(obp, 3), "slg": rounded(slg, 3), "wrcPlus": ops_plus,
                        "defensiveValue": rounded(max(-10, min(10, (field_pct - .965) * 400))),
                        "baserunningValue": rounded((sb * .2) - (cs * .4)), "games": int(games), "plateAppearances": int(pa),
                    },
                    "sourceNotes": "SABR Lahman 2025; franchise/decade totals. OPS+ and WAR are documented beta estimates.",
                    "_quality": pa * max(.5, ops_plus / 100),
                }

            pitcher_candidates: dict[str, dict] = {}
            for player_id, rows in p.groupby("playerID"):
                ip_outs = number(rows.IPouts.sum())
                innings = ip_outs / 3
                games = number(rows.G.sum())
                starts = number(rows.GS.sum())
                relief = max(0, games - starts)
                if innings < 18:
                    continue
                roles = []
                if starts >= 10 and starts / max(1, games) >= .40:
                    roles.append("SP")
                if relief >= 20 and relief / max(1, games) >= .60:
                    roles.append("RP")
                if not roles:
                    continue
                earned_runs = number(rows.ER.sum())
                hits = number(rows.H.sum())
                walks = number(rows.BB.sum())
                strikeouts = number(rows.SO.sum())
                homers = number(rows.HR.sum())
                hbp = number(rows.HBP.sum())
                era = 9 * earned_runs / max(1, innings)
                era_plus = round(100 * league_era / max(.01, era))
                whip = (hits + walks) / max(1, innings)
                fip = ((13 * homers + 3 * (walks + hbp) - 2 * strikeouts) / max(1, innings)) + 3.2
                war = max(-4, (innings / 200) * ((era_plus - 75) / 10))
                pitcher_candidates[str(player_id)] = {
                    "id": f"{franchise_id}-{decade}-{player_id}",
                    "playerId": str(player_id),
                    "name": names.get(str(player_id), str(player_id)),
                    "franchiseId": franchise_id,
                    "team": abbreviation,
                    "decade": decade,
                    "eligiblePositions": roles,
                    "type": "pitcher",
                    "isTwoWay": False,
                    "stats": {
                        "war": rounded(war), "eraPlus": era_plus, "era": rounded(era, 2), "whip": rounded(whip, 3),
                        "so": int(strikeouts), "wins": int(number(rows.W.sum())), "sv": int(number(rows.SV.sum())),
                    },
                    "scoringStats": {
                        "whip": rounded(whip, 3), "fip": rounded(fip, 2), "inningsPitched": rounded(innings),
                        "strikeoutRate": rounded(9 * strikeouts / max(1, innings), 2),
                        "walkRate": rounded(9 * walks / max(1, innings), 2),
                        "starts": int(starts), "reliefAppearances": int(relief),
                    },
                    "sourceNotes": "SABR Lahman 2025; franchise/decade totals. ERA+ and WAR are documented beta estimates.",
                    "_quality": innings * max(.5, era_plus / 100),
                }

            candidates = {**hitter_candidates, **pitcher_candidates}
            selected: set[str] = set()
            # Prioritize full fielding coverage plus five starters and three relievers.
            for position in ALL_CARD_POSITIONS:
                ranked = sorted(
                    (item for item in candidates.values() if position in item["eligiblePositions"]),
                    key=lambda item: item["_quality"], reverse=True,
                )
                target = 5 if position == "SP" else 3
                selected.update(item["playerId"] for item in ranked[:target])

            # Keep pools compact while retaining the required pitching depth.
            ranked_all = sorted(candidates.values(), key=lambda item: item["_quality"], reverse=True)
            for item in ranked_all:
                if len(selected) >= 32:
                    break
                selected.add(item["playerId"])
            if len(selected) > 36:
                protected = set()
                for position in ALL_CARD_POSITIONS:
                    ranked = sorted(
                        (item for item in candidates.values() if position in item["eligiblePositions"]),
                        key=lambda item: item["_quality"], reverse=True,
                    )
                    target = 5 if position == "SP" else 3 if position == "RP" else 1
                    protected.update(item["playerId"] for item in ranked[:target])
                keep = list(protected)
                keep.extend(item["playerId"] for item in ranked_all if item["playerId"] in selected and item["playerId"] not in protected)
                selected = set(keep[:36])

            for player_id in sorted(selected, key=lambda key: candidates[key]["_quality"], reverse=True):
                card = candidates[player_id]
                card.pop("_quality", None)
                cards.append(card)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps({"combinations": combinations, "players": cards}, ensure_ascii=False, separators=(",", ":"))
    args.output.write_text(payload, encoding="utf-8")
    print(f"Generated {len(cards)} cards across {len(combinations)} pools at {args.output}")


if __name__ == "__main__":
    main()
