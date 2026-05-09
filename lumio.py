#!/usr/bin/env python3
"""Lumio Leads — find local businesses without websites."""

import csv
import os
import sys
import time
from datetime import datetime

import click
import requests
from dotenv import load_dotenv
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.table import Table

load_dotenv()
console = Console()

PLACES_TEXT_SEARCH_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json"
PLACES_DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json"
DETAILS_FIELDS = "name,formatted_address,formatted_phone_number,website,url,business_status"

MAX_PAGES = 3  # Google Places returns up to 20 results per page, 3 pages = 60 max


def _text_search(query: str, api_key: str, page_token: str = None) -> dict:
    params = {"query": query, "key": api_key}
    if page_token:
        params["pagetoken"] = page_token
    resp = requests.get(PLACES_TEXT_SEARCH_URL, params=params, timeout=10)
    resp.raise_for_status()
    return resp.json()


def _place_details(place_id: str, api_key: str) -> dict:
    params = {"place_id": place_id, "fields": DETAILS_FIELDS, "key": api_key}
    resp = requests.get(PLACES_DETAILS_URL, params=params, timeout=10)
    resp.raise_for_status()
    return resp.json().get("result", {})


def _collect_place_ids(query: str, api_key: str, max_results: int, progress, task) -> list:
    place_ids = []
    next_page_token = None

    for page in range(1, MAX_PAGES + 1):
        if next_page_token:
            # Google requires a short pause before a pagetoken is valid
            time.sleep(2)

        data = _text_search(query, api_key, next_page_token)
        status = data.get("status")

        if status == "ZERO_RESULTS":
            break
        if status != "OK":
            console.print(
                f"\n[red]Google Places API error:[/red] {status} — "
                f"{data.get('error_message', 'no details provided')}"
            )
            sys.exit(1)

        ids = [r["place_id"] for r in data.get("results", [])]
        place_ids.extend(ids)
        progress.update(task, description=f"Found {len(place_ids)} listings (page {page})...")

        next_page_token = data.get("next_page_token")
        if not next_page_token or len(place_ids) >= max_results:
            break

    return place_ids[:max_results]


@click.group()
def cli():
    """Lumio Leads — surface local businesses with no website so you can sell them one."""


@cli.command()
@click.option("--location", "-l", required=True,
              help="City, neighbourhood, or address  e.g. 'Austin, TX'")
@click.option("--category", "-c", required=True,
              help="Business type to search  e.g. 'plumber', 'dentist', 'hair salon'")
@click.option("--max-results", "-m", default=60, show_default=True,
              help="Max businesses to check (capped at 60 by Google's free tier)")
@click.option("--output", "-o", default=None,
              help="CSV output path (auto-generated if omitted)")
@click.option("--api-key", envvar="GOOGLE_API_KEY",
              help="Google Places API key (or set GOOGLE_API_KEY in .env)")
def search(location, category, max_results, output, api_key):
    """Search for businesses in a location and export leads with no website to CSV."""

    if not api_key:
        console.print(
            "[red]Error:[/red] A Google Places API key is required.\n"
            "  • Pass it with [bold]--api-key YOUR_KEY[/bold], or\n"
            "  • Add [bold]GOOGLE_API_KEY=YOUR_KEY[/bold] to a [bold].env[/bold] file."
        )
        sys.exit(1)

    max_results = min(max_results, 60)
    query = f"{category} in {location}"

    if output is None:
        safe_cat = category.replace(" ", "_")
        safe_loc = location.replace(" ", "_").replace(",", "")
        date_str = datetime.now().strftime("%Y%m%d")
        output = f"leads_{safe_cat}_{safe_loc}_{date_str}.csv"

    console.print(
        f"\n[bold cyan]Lumio Leads[/bold cyan]  "
        f"searching for [yellow]{category}[/yellow] in [yellow]{location}[/yellow]\n"
    )

    with Progress(SpinnerColumn(), TextColumn("[progress.description]{task.description}"),
                  console=console) as progress:
        task = progress.add_task("Starting search...", total=None)

        place_ids = _collect_place_ids(query, api_key, max_results, progress, task)

        if not place_ids:
            console.print("[yellow]No businesses found for that search.[/yellow]")
            sys.exit(0)

        leads = []
        skipped = 0

        for i, pid in enumerate(place_ids):
            progress.update(task, description=f"Checking business {i + 1}/{len(place_ids)}...")
            details = _place_details(pid, api_key)

            if details.get("business_status") == "CLOSED_PERMANENTLY":
                skipped += 1
                continue

            if not details.get("website"):
                leads.append({
                    "name": details.get("name", ""),
                    "phone": details.get("formatted_phone_number", ""),
                    "address": details.get("formatted_address", ""),
                    "google_maps_url": details.get("url", ""),
                })

    with open(output, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["name", "phone", "address", "google_maps_url"])
        writer.writeheader()
        writer.writerows(leads)

    checked = len(place_ids) - skipped
    console.print(
        f"\n[bold green]Done![/bold green]  "
        f"Checked [bold]{checked}[/bold] active businesses — "
        f"[bold]{len(leads)}[/bold] have no website.\n"
        f"Leads saved to [cyan]{output}[/cyan]\n"
    )

    if leads:
        table = Table(title=f"Preview — first {min(10, len(leads))} leads", show_lines=True)
        table.add_column("Business Name", style="bold", min_width=25)
        table.add_column("Phone", min_width=15)
        table.add_column("Address")

        for lead in leads[:10]:
            table.add_row(lead["name"], lead["phone"], lead["address"])

        console.print(table)

        if len(leads) > 10:
            console.print(f"\n[dim]...and {len(leads) - 10} more in {output}[/dim]\n")


if __name__ == "__main__":
    cli()
