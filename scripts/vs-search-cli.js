#!/usr/bin/env node
import { config } from 'dotenv';
import { vectorStoreSearch } from '../lib/vector_store_search.js';

config();

function parseArgs(argv) {
  const args = { top_k: 5, query: '' };
  const rest = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--topk' || a === '--top_k') {
      const v = Number(argv[i + 1]);
      if (!Number.isNaN(v)) args.top_k = v;
      i++;
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
  const { query, top_k, help } = parseArgs(process.argv);
  if (help || !query) {
    console.log(`Usage:\n  node scripts/vs-search-cli.js "<your query>" [--topk 5]\n\nExamples:\n  node scripts/vs-search-cli.js "AI 技术"\n  node scripts/vs-search-cli.js "ChinaJoy" --topk 3`);
    process.exit(help ? 0 : 1);
  }

  try {
    const { json } = await vectorStoreSearch(query, top_k);
    console.log(JSON.stringify(json, null, 2));
  } catch (err) {
    console.error('Vector Store search failed:', err?.message || err);
    process.exit(1);
  }
}

main();
