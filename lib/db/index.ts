// The app's only door to Supabase. Routes and lib code import from "@/lib/db";
// nothing else creates Supabase clients (proxy.ts uses ./proxy for the session).
export { signIn, signOut, currentUserId } from "./auth";
export {
  createRun, getRun, listRuns, listRunChanges, updateRun, setInputUrls, permanentlyDeleteRun, resetArchive,
  DeleteBlockedError, type NewRun, type RunPatch,
} from "./runs";
export { removeRunVideos, signedVideoUrl, SIGNED_URL_TTL_S } from "./storage";
export { archiveVideo, retryDueArchives, MAX_ARCHIVE_ATTEMPTS } from "./archive";
export { getUsageStats, type UsageStats } from "./usage";
