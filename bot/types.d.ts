import { Scenes, Markup } from "telegraf";

export interface JobSearchSession {
    selectedResumeId?: string;
    region?: string;
    workSchedule?: string;
    employmentType?: string;
    professionalArea?: string;
    keywords?: string;
    coverLetter?: string;
}

export interface JobSearchContext extends Scenes.WizardContext {
    session: JobSearchSession;
}

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
}

export interface HHRegion {
    id: string;
    name: string;
    areas?: HHRegion[];
}