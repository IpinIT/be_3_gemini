import { Request, Response } from "express";
import { prisma } from "../index"; // Mengambil koneksi database dari index.ts
import { getFaceEmbedding } from "../utils/faceUtil";
import fs from "fs";

// 1. ENDPOINT REGISTRASI WAJAH
export const registerFace = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { name } = req.body;
    const file = req.file;

    if (!name || !file) {
      res.status(400).json({ error: "Name and face photo must be submitted!" });
      return;
    }

    const imagePath = file.path;

    // Ekstraksi Vektor Menggunakan AI Saat Registrasi
    const embeddingArray = await getFaceEmbedding(imagePath);

    if (!embeddingArray) {
      fs.unlinkSync(imagePath); // Hapus foto sampah
      res
        .status(400)
        .json({ error: "Face not detected in the uploaded image!" });
      return;
    }

    const embeddingString = `[${embeddingArray.join(",")}]`;

    // PENGUJIAN 4.2.1.3: INTEGRITAS FORMAT EKSTRAKSI VEKTOR

    console.log("\n[TESTING - PENGUJIAN INTEGRITAS VEKTOR (REGISTRASI)]");
    console.log(
      `✅ Validasi Panjang Vektor : ${embeddingArray.length} Dimensi`,
    );
    console.log(`✅ Sampel Vektor (5 awal)  :`, embeddingArray.slice(0, 5));
    console.log(
      `✅ Format Data pgvector    : ${embeddingString.substring(0, 55)}...]`,
    );
    console.log("=========================================================\n");
    // Simpan ke Database menggunakan Raw SQL
    await prisma.$executeRaw`
      INSERT INTO "FaceData" (name, "imagePath", embedding) 
      VALUES (${name}, ${imagePath}, ${embeddingString}::vector)
    `;

    res.status(201).json({
      success: true,
      message: "Face registration successful!",
      data: { name, imagePath },
    });
  } catch (error) {
    console.error("Error during registration:", error);
    if (req.file) fs.unlinkSync(req.file.path);
    res
      .status(500)
      .json({ success: false, error: "An error occurred on the server" });
  }
};

// 2. ENDPOINT PENGENALAN WAJAH & ABSENSI (DENGAN PENGUKURAN WAKTU)
export const recognizeFace = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const file = req.file;
    const earValue = parseFloat(req.body.earValue);

    if (!file || isNaN(earValue)) {
      if (file) fs.unlinkSync(file.path);
      res.status(400).json({ error: "Face photo and EAR value are required!" });
      return;
    }

    const imagePath = file.path;

    // PENGUJIAN 1: Waktu Inferensi AI (Ekstraksi Vektor)
    console.time("⏱️ ResNet Inference Time"); // Mulai catat waktu
    const embeddingArray = await getFaceEmbedding(imagePath);
    console.timeEnd("⏱️ ResNet Inference Time"); // Selesai catat & tampilkan di terminal
    if (!embeddingArray) {
      fs.unlinkSync(imagePath);
      res
        .status(400)
        .json({ error: "Face not detected in the uploaded image!" });
      return;
    }
    const embeddingString = `[${embeddingArray.join(",")}]`;

    // PENGUJIAN 2: Waktu Komputasi Database (Pencarian Vektor)
    console.time("🔍 pgvector Search Time"); // Mulai catat waktu
    const result: any = await prisma.$queryRaw`
      SELECT id, name, (embedding <-> ${embeddingString}::vector) as distance
      FROM "FaceData"
      ORDER BY distance ASC
      LIMIT 1;
    `;
    console.timeEnd("🔍 pgvector Search Time"); // Selesai catat & tampilkan di terminal

    if (!result || result.length === 0) {
      fs.unlinkSync(imagePath);
      res
        .status(404)
        .json({ error: "No master face data found in the database." });
      return;
    }

    const bestMatch = result[0];
    const THRESHOLD = 0.4; // Ambang batas toleransi kemiripan Euclidean

    if (bestMatch.distance < THRESHOLD) {
      await prisma.attendanceLog.create({
        data: {
          faceId: bestMatch.id,
          earValue: earValue,
          similarityScore: bestMatch.distance,
        },
      });

      fs.unlinkSync(imagePath); // Bersihkan file foto absen

      res.status(200).json({
        success: true,
        message: `Attendance successful! Welcome, ${bestMatch.name}.`,
        data: {
          name: bestMatch.name,
          distance: bestMatch.distance,
          earValue: earValue,
        },
      });
    } else {
      fs.unlinkSync(imagePath);
      res.status(401).json({
        success: false,
        message: "Face not recognized! Identity does not match the database.",
        distance: bestMatch.distance,
      });
    }
  } catch (error) {
    console.error("Error during face recognition:", error);
    if (req.file) fs.unlinkSync(req.file.path);
    res
      .status(500)
      .json({ success: false, error: "An error occurred on the server" });
  }
};

// 3. ENDPOINT MANAJEMEN WAJAH (GET, UPDATE, DELETE)
export const getFaces = async (req: Request, res: Response): Promise<void> => {
  try {
    const faces = await prisma.$queryRaw`
      SELECT id, name, "imagePath", "createdAt" 
      FROM "FaceData" 
      ORDER BY "createdAt" DESC
    `;
    res.status(200).json({ success: true, data: faces });
  } catch (error) {
    console.error("Error during face data retrieval:", error);
    res
      .status(500)
      .json({ success: false, error: "An error occurred on the server" });
  }
};

export const updateFace = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const numericId = parseInt(id as string, 10);

    if (!name) {
      res.status(400).json({ error: "New name cannot be empty!" });
      return;
    }

    const result: any = await prisma.$queryRaw`
      UPDATE "FaceData" 
      SET name = ${name} 
      WHERE id = ${numericId} 
      RETURNING id, name, "imagePath";
    `;

    if (!result || result.length === 0) {
      res.status(404).json({ error: "Member data not found." });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Member name updated successfully!",
      data: result[0],
    });
  } catch (error) {
    console.error("Error during face update:", error);
    res
      .status(500)
      .json({ success: false, error: "An error occurred on the server" });
  }
};

export const deleteFace = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const numericId = parseInt(id as string, 10);

    const face: any = await prisma.$queryRaw`
      SELECT id, "imagePath" FROM "FaceData" WHERE id = ${numericId};
    `;

    if (!face || face.length === 0) {
      res.status(404).json({ error: "Member data not found." });
      return;
    }

    const imagePath = face[0].imagePath;

    await prisma.attendanceLog.deleteMany({ where: { faceId: numericId } });
    await prisma.$executeRaw`DELETE FROM "FaceData" WHERE id = ${numericId};`;

    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }

    res
      .status(200)
      .json({ success: true, message: "Member data deleted successfully!" });
  } catch (error) {
    console.error("Error during face deletion:", error);
    res
      .status(500)
      .json({ success: false, error: "An error occurred on the server" });
  }
};

// 4. ENDPOINT MANAJEMEN LOG ABSENSI (GET & DELETE)
export const getLogs = async (req: Request, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;
    let start: Date, end: Date;

    if (startDate && endDate) {
      start = new Date(startDate as string);
      start.setHours(0, 0, 0, 0);
      end = new Date(endDate as string);
      end.setHours(23, 59, 59, 999);
    } else {
      const today = new Date();
      start = new Date(today);
      start.setHours(0, 0, 0, 0);
      end = new Date(today);
      end.setHours(23, 59, 59, 999);
    }

    const logs: any[] = await prisma.$queryRaw`
      SELECT a.id, a."faceId", a.timestamp, a."earValue", a."similarityScore", f.name
      FROM "AttendanceLog" a JOIN "FaceData" f ON a."faceId" = f.id
      WHERE a.timestamp >= ${start} AND a.timestamp <= ${end}
      ORDER BY a.timestamp DESC;
    `;

    const allUsers: any[] =
      await prisma.$queryRaw`SELECT id, name FROM "FaceData" ORDER BY name ASC;`;

    const earliestLogs = new Map<number, { time: Date; name: string }>();
    logs.forEach((log) => {
      const logDate = new Date(log.timestamp);
      if (!earliestLogs.has(log.faceId))
        earliestLogs.set(log.faceId, { time: logDate, name: log.name });
      else if (logDate < earliestLogs.get(log.faceId)!.time)
        earliestLogs.set(log.faceId, { time: logDate, name: log.name });
    });

    const presentList: any[] = [],
      lateList: any[] = [],
      absentList: any[] = [];
    earliestLogs.forEach((value, faceId) => {
      const userData = { id: faceId, name: value.name, time: value.time };
      presentList.push(userData);
      if (value.time.getHours() >= 8) lateList.push(userData);
    });

    allUsers.forEach((user) => {
      if (!earliestLogs.has(user.id))
        absentList.push({ id: user.id, name: user.name });
    });

    res.status(200).json({
      success: true,
      summary: {
        totalRegistered: allUsers.length,
        totalPresent: presentList.length,
        totalLate: lateList.length,
        totalAbsent: absentList.length,
        details: {
          registered: allUsers,
          present: presentList,
          late: lateList,
          absent: absentList,
        },
      },
      period: { start, end },
      data: logs,
    });
  } catch (error) {
    console.error("Error during log retrieval:", error);
    res
      .status(500)
      .json({ success: false, error: "An error occurred on the server" });
  }
};

export const deleteLog = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const numericId = parseInt(id as string, 10);
    await prisma.$executeRaw`DELETE FROM "AttendanceLog" WHERE id = ${numericId};`;
    res
      .status(200)
      .json({ success: true, message: "One attendance record deleted!" });
  } catch (error) {
    console.error("Error during log deletion:", error);
    res
      .status(500)
      .json({ success: false, error: "An error occurred on the server" });
  }
};
