import fs from 'node:fs';
import { addDays, tallinnNow } from '../src/transit.js';

// Real-feed tests follow the acquired timetable; synthetic algorithm fixtures
// keep their explicit dates. Prefer a weekday for the morning rider journeys.
const data = JSON.parse(fs.readFileSync(new URL('../data/derived/network.json', import.meta.url)));
let date = tallinnNow(new Date(Math.max(Date.parse(data.snapshot), Date.parse(data.railSnapshot)))).date;
while ([0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay())) date = addDays(date, 1);
export const timetableDate = date;
