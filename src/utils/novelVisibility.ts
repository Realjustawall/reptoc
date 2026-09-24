export function getNovelApprovalStatus(novel: any): string {
  return String(novel?.approvalStatus ?? novel?.approval_status ?? "pending_approval")
    .trim()
    .toLowerCase();
}

export function isNovelApprovedForDiscovery(novel: any): boolean {
  return getNovelApprovalStatus(novel) === "approved";
}

export function isNovelPendingEditorialReview(novel: any): boolean {
  const approvalStatus = getNovelApprovalStatus(novel);
  const hasSubmittedChapters = Number(novel?.editorial_counts?.submitted || 0) > 0;
  return approvalStatus === "pending_approval" || (approvalStatus === "approved" && hasSubmittedChapters);
}
