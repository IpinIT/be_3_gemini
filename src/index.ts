// src/index.ts
import express, { Request, Response } from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import faceRoutes from "./routes/faceRoutes";
import { loadFaceModels } from './utils/faceUtil';

dotenv.config();

// Inisialisasi Express dan Prisma
const app = express();
// Menggunakan PrismaClient (sudah versi 6 dari fase 1)
export const prisma = new PrismaClient();

// Middleware
app.use(cors()); // Mengizinkan Flutter untuk mengakses API ini
app.use(express.json()); // Agar bisa membaca data format JSON
app.use("/uploads", express.static("src/uploads")); // Agar foto bisa diakses lewat URL

// Cek apakah server berjalan
app.get("/", (req: Request, res: Response) => {
  res.send("The Face Attendance Backend Server is Running Smoothly!");
});

app.use("/api", faceRoutes);

// Konfigurasi Port
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`[server]: Server is running at http://localhost:${PORT}`);
  // Cek koneksi Database saat server nyala
    try {
        await prisma.$connect();
        console.log("✅ Successfully connected to Neon (PostgreSQL) Database");
    } catch (error) {
        console.error("❌ Failed to connect to Database:", error);
    }
  // Memuat model AI saat server berjalan
  await loadFaceModels(); 
});