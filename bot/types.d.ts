import { Scenes } from "telegraf";

/**
 * Расширяем WizardSessionData под наши нужды
 */
export interface JobSearchSession extends Scenes.WizardSessionData {
    selectedResumeId?: string;
    region?: string;
    workSchedule?: string;
    employmentType?: string;
    professionalArea?: string;
    keywords?: string;
    coverLetter?: string;
}

/**
 * Кастомный контекст, который знает о нашей сессии
 */
export interface JobSearchContext extends Scenes.WizardContext<JobSearchSession> {}

export interface Vacancy {
    id: string;
    name: string;
    employer?: {
        id?: string;
        name?: string;
    };
    salary?: {
        from?: number;
        to?: number;
        currency?: string;
        gross?: boolean;
    };
    area?: {
        id?: string;
        name?: string;
    };
    published_at?: string;
    alternate_url?: string;
    url?: string;
    // Другие поля по необходимости
}