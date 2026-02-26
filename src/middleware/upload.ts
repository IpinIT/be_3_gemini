// src/middleware/upload.ts
import multer from 'multer';
import path from 'path';

// Konfigurasi tempat penyimpanan dan penamaan file
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Foto akan disimpan di folder src/uploads/
    cb(null, 'src/uploads/'); 
  },
  filename: (req, file, cb) => {
    // Format nama file: waktu_sekarang-acak.ekstensi (contoh: 170812345-1234.jpg)
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

export const upload = multer({ storage });