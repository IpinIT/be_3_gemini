// src/utils/faceUtil.ts
import * as faceapi from "@vladmandic/face-api";
import canvas from "canvas";
import path from "path";

// Monkey-patching agar face-api bisa jalan di Node.js (bukan di browser)
const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData } as any);

// Fungsi untuk memuat model AI (hanya dipanggil sekali saat server nyala)
export const loadFaceModels = async () => {
  const modelsPath = path.join(__dirname, "../../models"); // Mengarah ke folder models di luar src
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelsPath);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(modelsPath);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(modelsPath); // Dibutuhkan untuk meluruskan wajah
  console.log("[AI]: Face Recognition Model successfully loaded!");
};

// Fungsi inti untuk membaca gambar dan mengubahnya jadi 128 angka
export const getFaceEmbedding = async (
  imagePath: string,
): Promise<number[] | null> => {
  try {
    // Membaca file gambar sebagai elemen Canvas
    const img = await canvas.loadImage(imagePath);

    // Mendeteksi wajah tunggal dengan akurasi tinggi, lalu mengekstrak vektor (descriptor)
    const detection = await faceapi
      .detectSingleFace(img as any)
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!detection) {
      return null; // Wajah tidak ditemukan di foto
    }

    // Mengubah format Float32Array bawaan face-api menjadi Array biasa
    return Array.from(detection.descriptor);
  } catch (error) {
    console.error("Error during face embedding extraction:", error);
    return null;
  }
};
