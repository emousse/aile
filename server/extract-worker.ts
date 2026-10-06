import { parentPort, workerData } from 'node:worker_threads';
import { extractArticle } from './extraction';
import { AppError } from './errors';
try { parentPort!.postMessage({ type: 'aile:extraction', document: extractArticle(workerData.html, workerData.url) }); }
catch (error) { parentPort!.postMessage({ type: 'aile:extraction', error: error instanceof AppError ? { code: error.code, message: error.message, status: error.status } : { code: 'EXTRACTION_FAILED', message: 'Cette page n’a pas pu être préparée.', status: 422 } }); }
