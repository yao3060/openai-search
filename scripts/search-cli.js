#!/usr/bin/env node
import { config } from 'dotenv';
import { semanticSearch, formatSearchResults } from '../lib/search.js';

config();

function parseArgs(argv) {
  const args = { top_k: 10, query: '', format: 'json', pretty: false };
  const rest = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--topk' || a === '--top_k') {
      const v = Number(argv[i + 1]);
      if (!Number.isNaN(v)) args.top_k = v;
      i++;
    } else if (a === '--json') {
      args.format = 'json';
    } else if (a === '--text') {
      args.format = 'text';
    } else if (a === '--pretty') {
      args.pretty = true;
    } else if (a === '--help' || a === '-h') {
      args.help = true;
    } else {
      rest.push(a);
    }
  }
  args.query = rest.join(' ').trim();
  return args;
}

async function main() {
  const { query, top_k, help, format, pretty } = parseArgs(process.argv);
  if (help || !query) {
    console.log(`Usage:\n  node scripts/search-cli.js "<your query>" [--topk 5] [--json|--text] [--pretty]\n\nFlags:\n  --topk, --top_k   Number of results (default: 10)\n  --json            Output raw JSON (default)\n  --text            Output human-readable text\n  --pretty          Pretty-print JSON (works with --json)\n\nExamples:\n  node scripts/search-cli.js "AI 技术"\n  node scripts/search-cli.js "人工智能 应用" --topk 5 --json --pretty\n  node scripts/search-cli.js "ChinaJoy" --text`);
    process.exit(help ? 0 : 1);
  }

  try {
    const results = await semanticSearch(query, top_k);
    if (format === 'text') {
      const text = formatSearchResults(results);
      console.log(text);
    } else {
      // Default: JSON output (raw results from semanticSearch)
      const json = results;
      console.log(JSON.stringify(json, null, pretty ? 2 : 0));
    }
  } catch (err) {
    console.error('Search failed:', err?.message || err);
    process.exit(1);
  }
}

main();
