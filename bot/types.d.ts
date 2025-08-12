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
