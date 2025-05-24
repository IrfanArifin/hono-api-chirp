import { writeFile } from 'fs/promises';
import { join } from 'path';

// Format tanggal dan waktu untuk log
const getTimestamp = (): string => {
  const now = new Date();
  return now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }); // Sesuaikan dengan WIB
};

// Path untuk menyimpan log ke file (opsional)
const logFilePath = join(process.cwd(), 'logs', 'app.log');

// Pastikan folder logs ada (opsional, jika Anda ingin menyimpan ke file)
const ensureLogDirectory = async () => {
  try {
    await Bun.write('logs/.gitkeep', ''); // Buat folder logs jika belum ada
  } catch (error) {
    // Folder sudah ada, abaikan error
  }
};

// Fungsi untuk mencatat log
const log = async (level: string, message: string, ...meta: any[]) => {
  const timestamp = getTimestamp();
  const logMessage = `[${timestamp}] ${level.toUpperCase()}: ${message} ${
    meta.length ? JSON.stringify(meta) : ''
  }`;

  // Cetak ke konsol
  console.log(logMessage);

  // Simpan ke file (opsional)
  try {
    await ensureLogDirectory();
    await writeFile(logFilePath, logMessage + '\n', { flag: 'a' });
  } catch (error) {
    console.error(`Failed to write log to file: ${error}`);
  }
};

// Logger dengan level berbeda
export const logger = {
  info: (message: string, ...meta: any[]) => log('info', message, ...meta),
  error: (message: string, ...meta: any[]) => log('error', message, ...meta),
  warn: (message: string, ...meta: any[]) => log('warn', message, ...meta),
  debug: (message: string, ...meta: any[]) => log('debug', message, ...meta),
};