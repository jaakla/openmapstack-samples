"""Configure two monitors, export their incident digest, or email that digest.

Standard library only. No credentials in output; default command is a dry run.
"""
import argparse
import json
import os
from pathlib import Path
import smtplib
import ssl
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
API = 'https://incidents.betterstack.com'


def configured_monitors():
    return json.loads((ROOT / 'monitoring/betterstack.json').read_text())


def api(path, method='GET', body=None):
    # Pagination may supply an absolute next URL. Never send a token elsewhere.
    url = path if path.startswith('https://') else API + path
    if urlsplit(url).netloc != urlsplit(API).netloc:
        raise ValueError('Unexpected Better Stack pagination host')
    token = os.environ['BETTERSTACK_API_TOKEN']
    headers = {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}
    data = None if body is None else json.dumps(body).encode()
    with urlopen(Request(url, data=data, headers=headers, method=method), timeout=30) as response:
        return json.load(response)


def all_pages(path, request=api):
    rows = []
    seen = set()
    while path:
        if path in seen:
            raise ValueError('Repeated Better Stack pagination URL')
        seen.add(path)
        result = request(path)
        rows.extend(result['data'])
        path = result.get('pagination', {}).get('next')
    return rows


def apply_monitors(request=api):
    existing = all_pages('/api/v2/monitors?per_page=50', request)
    team = os.environ.get('BETTERSTACK_TEAM_NAME')
    for config in configured_monitors():
        matches = [row for row in existing if row['attributes']['url'] == config['url']
                   and (not team or row['attributes'].get('team_name') == team)]
        if len(matches) > 1:
            raise ValueError('Multiple monitors match ' + config['url'])
        if matches:
            request('/api/v2/monitors/' + str(matches[0]['id']), 'PATCH', config)
            print('Updated: ' + config['pronounceable_name'])
        else:
            payload = {**config, **({'team_name': team} if team else {})}
            request('/api/v2/monitors', 'POST', payload)
            print('Created: ' + config['pronounceable_name'])


def report(request=api, now=None):
    now = now or datetime.now(timezone.utc)
    since = now - timedelta(days=1)
    team = os.environ.get('BETTERSTACK_TEAM_NAME')
    query = urlencode({'per_page': 50, **({'team_name': team} if team else {})})
    monitors = all_pages('/api/v2/monitors?' + query, request)
    wanted = {config['url'] for config in configured_monitors()}
    monitors = [row for row in monitors if row['attributes']['url'] in wanted]
    if {row['attributes']['url'] for row in monitors} != wanted:
        raise ValueError('Configure both monitors before generating a digest')
    lines = ['Tallinn liigub – seire koondraport', f'{since.isoformat()} – {now.isoformat()}', '']
    for monitor in monitors:
        attributes = monitor['attributes']
        lines.append(f"{attributes['pronounceable_name']}: {attributes['status']}")
        # Include unresolved incidents from earlier days as well as new and
        # recently recovered incidents. Read-only: never resolve/delete history.
        params = {'monitor_id': monitor['id'], 'per_page': 50}
        if team:
            params['team_name'] = team
        incidents = all_pages('/api/v3/incidents?' + urlencode(params), request)
        unique = {row['id']: row for row in incidents}
        recent = []
        for incident in unique.values():
            details = incident['attributes']
            ended = details.get('resolved_at')
            if ended and datetime.fromisoformat(ended.replace('Z', '+00:00')) < since:
                continue
            recent.append(incident)
            lines.append(f"- {details['started_at']} → {ended or 'avatud'}: {details.get('cause', 'intsident')} (#{incident['id']})")
        if not recent:
            lines.append('- Viimase 24 tunni jooksul intsidente pole.')
        lines.append('')
    return '\n'.join(lines)


def send_report(path):
    message = EmailMessage()
    message['Subject'] = 'Tallinn liigub – seire koondraport'
    message['From'] = os.environ['MONITORING_EMAIL_FROM']
    message['To'] = os.environ['MONITORING_EMAIL_TO']
    message.set_content(Path(path).read_text())
    context = ssl.create_default_context()
    with smtplib.SMTP(os.environ['MONITORING_SMTP_HOST'], int(os.environ.get('MONITORING_SMTP_PORT') or '587'), timeout=30) as smtp:
        smtp.starttls(context=context)
        smtp.login(os.environ['MONITORING_SMTP_USERNAME'], os.environ['MONITORING_SMTP_PASSWORD'])
        smtp.send_message(message)
    print('Monitoring digest sent.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['plan', 'apply', 'report', 'send'], default='plan', nargs='?')
    parser.add_argument('--output', default='-')
    parser.add_argument('--input')
    args = parser.parse_args()
    if args.command == 'plan':
        print(json.dumps(configured_monitors(), ensure_ascii=False, indent=2))
    elif args.command == 'apply':
        apply_monitors()
    elif args.command == 'report':
        text = report()
        if args.output == '-':
            print(text)
        else:
            Path(args.output).write_text(text)
    else:
        if not args.input:
            parser.error('send requires --input')
        send_report(args.input)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # SMTP and API exceptions can contain private response content.
        raise SystemExit(f'Monitoring command failed ({type(error).__name__}); check credentials and service access.') from None
