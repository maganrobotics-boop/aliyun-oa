export type CourseProject = { id: string; title: string; description: string; outcomes: string };
export type IndustrialProject = { id: string; title: string; url: string; description: string; stage: string };
export const courseProjects: CourseProject[];
export const industrialProjects: IndustrialProject[];
export function academicSemester(now?: number): { id: string; label: string };
export function projectCourseIds(courses: { id: string; parentId?: string; parentProject?: string }[], projectId: string): string[];
