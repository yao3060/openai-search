#!/usr/bin/env node

import { config } from 'dotenv';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
config();

const VECTOR_STORE_ID = process.env.OPENAI_VECTOR_STORE_ID;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_TMP_DIR = path.resolve(__dirname, '../data/tmp_uploads');

/**
 * Delete files from Vector Store
 * @param {Object} opts
 * @param {boolean} opts.onlyTxt - if true, delete only files whose original filename ends with .txt
 */
async function deleteVectorStoreFiles({ onlyTxt = false } = {}) {
  console.log(`Deleting files from Vector Store: ${VECTOR_STORE_ID}`);
  
  try {
    // List all files in the vector store
    const listResponse = await fetch(`https://api.openai.com/v1/vector_stores/${VECTOR_STORE_ID}/files`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v2',
        ...(process.env.OPENAI_ORGANIZATION && { 'OpenAI-Organization': process.env.OPENAI_ORGANIZATION }),
        ...(process.env.OPENAI_PROJECT && { 'OpenAI-Project': process.env.OPENAI_PROJECT })
      }
    });

    if (!listResponse.ok) {
      const errorText = await listResponse.text();
      throw new Error(`Failed to list vector store files: ${listResponse.status} ${errorText}`);
    }

    const { data: files } = await listResponse.json();
    console.log(`Found ${files.length} files in vector store`);

    if (files.length === 0) {
      console.log('No files to delete in vector store');
      return [];
    }

    // Helper to fetch filename from Files API for filtering
    async function fetchFilenameForVectorStoreFile(vsFile) {
      const fileId = vsFile.file_id || vsFile.id;
      if (!fileId) return undefined;
      try {
        const fr = await fetch(`https://api.openai.com/v1/files/${fileId}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            ...(process.env.OPENAI_ORGANIZATION && { 'OpenAI-Organization': process.env.OPENAI_ORGANIZATION }),
            ...(process.env.OPENAI_PROJECT && { 'OpenAI-Project': process.env.OPENAI_PROJECT })
          }
        });
        if (!fr.ok) return undefined;
        const meta = await fr.json();
        return meta?.filename;
      } catch {
        return undefined;
      }
    }

    // Delete files from vector store
    const deletedFiles = [];
    for (const file of files) {
      // If onlyTxt is enabled, skip non-.txt based on filename
      if (onlyTxt) {
        const filename = await fetchFilenameForVectorStoreFile(file);
        if (!filename || !filename.toLowerCase().endsWith('.txt')) {
          continue;
        }
      }
      try {
        const deleteResponse = await fetch(`https://api.openai.com/v1/vector_stores/${VECTOR_STORE_ID}/files/${file.id}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'OpenAI-Beta': 'assistants=v2',
            ...(process.env.OPENAI_ORGANIZATION && { 'OpenAI-Organization': process.env.OPENAI_ORGANIZATION }),
            ...(process.env.OPENAI_PROJECT && { 'OpenAI-Project': process.env.OPENAI_PROJECT })
          }
        });

        if (deleteResponse.ok) {
          console.log(`  ✅ Deleted vector store file: ${file.id}`);
          deletedFiles.push(file.id);
        } else {
          const errorText = await deleteResponse.text();
          console.error(`  ❌ Failed to delete vector store file ${file.id}: ${errorText}`);
        }
      } catch (error) {
        console.error(`  ❌ Error deleting vector store file ${file.id}:`, error.message);
      }
    }

    return deletedFiles;
  } catch (error) {
    console.error('Error deleting vector store files:', error.message);
    return [];
  }
}

/**
 * Delete all uploaded files from OpenAI Files storage
 */
async function deleteUploadedFiles() {
  console.log('Deleting files from OpenAI Files storage...');
  
  try {
    // List all files
    const listResponse = await fetch('https://api.openai.com/v1/files', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        ...(process.env.OPENAI_ORGANIZATION && { 'OpenAI-Organization': process.env.OPENAI_ORGANIZATION }),
        ...(process.env.OPENAI_PROJECT && { 'OpenAI-Project': process.env.OPENAI_PROJECT })
      }
    });

    if (!listResponse.ok) {
      const errorText = await listResponse.text();
      throw new Error(`Failed to list files: ${listResponse.status} ${errorText}`);
    }

    const { data: files } = await listResponse.json();
    console.log(`Found ${files.length} files in storage`);

    if (files.length === 0) {
      console.log('No files to delete in storage');
      return [];
    }

    // Delete each file
    const deletedFiles = [];
    for (const file of files) {
      try {
        const deleteResponse = await fetch(`https://api.openai.com/v1/files/${file.id}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            ...(process.env.OPENAI_ORGANIZATION && { 'OpenAI-Organization': process.env.OPENAI_ORGANIZATION }),
            ...(process.env.OPENAI_PROJECT && { 'OpenAI-Project': process.env.OPENAI_PROJECT })
          }
        });

        if (deleteResponse.ok) {
          console.log(`  ✅ Deleted file: ${file.id} (${file.filename})`);
          deletedFiles.push(file.id);
        } else {
          const errorText = await deleteResponse.text();
          console.error(`  ❌ Failed to delete file ${file.id}: ${errorText}`);
        }
      } catch (error) {
        console.error(`  ❌ Error deleting file ${file.id}:`, error.message);
      }
    }

    return deletedFiles;
  } catch (error) {
    console.error('Error deleting uploaded files:', error.message);
    return [];
  }
}

/**
 * Delete the Vector Store itself (optional)
 */
async function deleteVectorStore() {
  console.log(`Deleting Vector Store: ${VECTOR_STORE_ID}`);
  
  try {
    const deleteResponse = await fetch(`https://api.openai.com/v1/vector_stores/${VECTOR_STORE_ID}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'assistants=v2',
        ...(process.env.OPENAI_ORGANIZATION && { 'OpenAI-Organization': process.env.OPENAI_ORGANIZATION }),
        ...(process.env.OPENAI_PROJECT && { 'OpenAI-Project': process.env.OPENAI_PROJECT })
      }
    });

    if (deleteResponse.ok) {
      console.log(`✅ Deleted Vector Store: ${VECTOR_STORE_ID}`);
      return true;
    } else {
      const errorText = await deleteResponse.text();
      console.error(`❌ Failed to delete Vector Store: ${errorText}`);
      return false;
    }
  } catch (error) {
    console.error('Error deleting Vector Store:', error.message);
    return false;
  }
}

/**
 * Delete all local .txt files under the specified directory (non-recursive)
 */
async function deleteLocalTxtFiles(dir = DEFAULT_TMP_DIR) {
  const targetDir = path.resolve(dir);
  console.log(`Deleting local .txt files in: ${targetDir}`);

  try {
    const entries = await fs.readdir(targetDir, { withFileTypes: true });
    let count = 0;
    for (const ent of entries) {
      if (ent.isFile() && ent.name.toLowerCase().endsWith('.txt')) {
        const fp = path.join(targetDir, ent.name);
        try {
          await fs.unlink(fp);
          console.log(`  🗑️  Deleted: ${ent.name}`);
          count++;
        } catch (err) {
          console.error(`  ❌ Failed to delete ${ent.name}: ${err.message}`);
        }
      }
    }
    if (count === 0) console.log('No .txt files found.');
    return count;
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('Directory not found, skipping .txt cleanup.');
      return 0;
    }
    console.error('Error deleting .txt files:', err.message);
    return 0;
  }
}

/**
 * Parse CLI arguments
 */
function parseArgs(argv) {
  const args = { deleteTxt: false, txtDir: undefined, help: false, vsTxtOnly: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--delete-txt' || a === '--rm-txt') {
      args.deleteTxt = true;
    } else if (a === '--vs-txt-only' || a === '--vector-txt-only') {
      args.vsTxtOnly = true;
    } else if (a === '--txt-dir') {
      args.txtDir = argv[i + 1];
      i++;
    } else if (a === '--help' || a === '-h') {
      args.help = true;
    }
  }
  return args;
}

/**
 * Main cleanup function
 */
async function cleanup(opts = {}) {
  const { deleteTxt = false, txtDir, vsTxtOnly = false } = opts;
  try {
    console.log('🧹 Starting OpenAI storage cleanup...');
    console.log(`Vector Store ID: ${VECTOR_STORE_ID}`);

    if (!VECTOR_STORE_ID) {
      console.log('⚠️  No OPENAI_VECTOR_STORE_ID found, skipping vector store cleanup');
    }

    // Step 1: Delete files from Vector Store
    let vectorStoreFiles = [];
    if (VECTOR_STORE_ID) {
      vectorStoreFiles = await deleteVectorStoreFiles({ onlyTxt: vsTxtOnly });
    }

    // Step 2: Delete files from Files storage (skip when only targeting .txt in Vector Store)
    let uploadedFiles = [];
    if (!vsTxtOnly) {
      uploadedFiles = await deleteUploadedFiles();
    } else {
      console.log('\nℹ️  Skipping OpenAI Files storage deletion because --vs-txt-only is set');
    }

    // Step 2.5: Optionally delete local .txt files
    let localTxtDeleted = 0;
    if (deleteTxt) {
      localTxtDeleted = await deleteLocalTxtFiles(txtDir || DEFAULT_TMP_DIR);
    }

    // Step 3: Optionally delete the Vector Store itself
    let vectorStoreDeleted = false;
    if (VECTOR_STORE_ID) {
      console.log('\n❓ Delete the Vector Store itself? (This will require creating a new one)');
      // For now, we'll skip this step - user can uncomment if needed
      // vectorStoreDeleted = await deleteVectorStore();
      console.log('ℹ️  Keeping Vector Store (uncomment deleteVectorStore() call to remove it)');
    }

    // Summary
    console.log('\n📊 Cleanup Summary:');
    console.log(`  Vector Store files deleted: ${vectorStoreFiles.length}${vsTxtOnly ? ' (only .txt)' : ''}`);
    console.log(`  Uploaded files deleted: ${uploadedFiles.length}${vsTxtOnly ? ' (skipped due to --vs-txt-only)' : ''}`);
    if (deleteTxt) {
      console.log(`  Local .txt files deleted: ${localTxtDeleted}`);
    } else {
      console.log('  Local .txt files deleted: (skipped)');
    }
    console.log(`  Vector Store deleted: ${vectorStoreDeleted ? 'Yes' : 'No'}`);
    
    if (uploadedFiles.length > 0 || vectorStoreFiles.length > 0) {
      console.log('\n✅ Cleanup completed successfully!');
      console.log('💡 You can now run the indexing script again when your API quota is restored.');
    } else {
      console.log('\n✅ No files found to delete.');
    }

  } catch (error) {
    console.error('❌ Cleanup failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run cleanup if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`Usage:\n  node scripts/cleanup-storage.js [--vs-txt-only] [--delete-txt] [--txt-dir <path>]\n\nOptions:\n  --vs-txt-only      Delete only .txt files from the Vector Store (server-side)\n  --delete-txt       Delete all local .txt files (default dir: data/tmp_uploads)\n  --txt-dir <path>   Override the directory to search for local .txt files\n  -h, --help         Show this help message`);
    process.exit(0);
  }
  cleanup({ deleteTxt: args.deleteTxt, txtDir: args.txtDir, vsTxtOnly: args.vsTxtOnly });
}
