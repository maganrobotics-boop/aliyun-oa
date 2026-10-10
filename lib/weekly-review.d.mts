import type { ReviewPolicy } from './review-routing.mjs';
export function weeklyReviewPayload(payload:Record<string,unknown>,policy:ReviewPolicy|null,requesterEmail:string):Record<string,unknown> & {circulationApprovers:ReviewPolicy['technical']};
export function assertWeeklyReviewRoute(payload:Record<string,unknown>,policy:ReviewPolicy|null,requesterEmail:string):void;
export function weeklyAccepted(row:any,payload:any):boolean;
