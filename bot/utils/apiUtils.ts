import dotenv from "dotenv";
dotenv.config();

import axios from "axios";

const BACKEND_URL = process.env.BACKEND_URL;

if (!BACKEND_URL) {
    throw new Error("BACKEND_URL is not defined");
}

// Получение резюме пользователя
export async function getUserResumes(telegramId: number) {
    try {
        const response = await axios.get(`${BACKEND_URL}/user/${telegramId}/resumes`);
        return response.data;
    } catch (error) {
        console.error("Error fetching resumes:", error);
        throw new Error("Failed to fetch resumes");
    }
}

// Поиск вакансий
export async function searchVacancies(payload: any): Promise<any[]> {
    try {
        const response = await axios.post(`${BACKEND_URL}/search`, payload);
        return response.data;
    } catch (error) {
        console.error("Error searching vacancies:", error);
        throw new Error("Failed to search vacancies");
    }
}