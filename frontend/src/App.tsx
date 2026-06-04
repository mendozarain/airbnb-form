import { FieldArray, Form, Formik } from "formik";
import { CalendarDays, Check, Copy, Eye, LogOut, Plus, Send, Settings, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GuestSubmission } from "@cozy-d-714/shared";
import { checkGoogleSession, confirmSubmission, createInvite, createPassword, deleteInvite, deleteSubmission, getAdminFileUrl, getBrowserLivePreview, getCurrentAdmin, getEmailTemplate, getInvite, getPasswordState, getSettingsStatus, getSubmission, listInvites, listSubmissions, rejectSubmission, resetSubmittingSubmission, saveEmailTemplate, submitGuestForm, uploadGoogleStorageState, uploadGuestFile } from "./api";
import { getAdminSession, isAuthConfigured, signInAdmin, signOutAdmin, type AdminSession } from "./authClient";

type InviteState = {
  token: string;
  checkIn: string;
  checkOut: string;
  buildingCode: string;
  unitNumber: string;
  ownerName: string;
  ownerContact: string;
  minorIdCutoff: number;
};

type GuestFormValues = Omit<GuestSubmission, "acceptedRules"> & {
  acceptedRules: boolean;
};

type SettingsStatus = {
  connected: boolean;
  hasStorageState: boolean;
  expired: boolean;
  connectedAt?: string;
  lastCheck?: {
    checkedAt: string;
    valid: boolean;
    message: string;
  } | null;
  email: {
    configured: boolean;
    mode: string;
    workerReady: boolean;
  };
};

type EmailTemplate = {
  subject: string;
  html: string;
};

type LocalIdPreview = {
  url: string;
  filename: string;
  contentType: string;
};

export function App() {
  const path = window.location.pathname;
  const inviteMatch = path.match(/^\/invite\/(.+)/);

  if (inviteMatch) {
    return <GuestFlow token={inviteMatch[1]} />;
  }

  if (path.startsWith("/sign-in")) {
    return <AuthPage />;
  }

  return <AdminGate />;
}

function AuthPage() {
  if (!isAuthConfigured()) {
    return <CenteredMessage title="Neon Auth is not configured" body="Set VITE_NEON_AUTH_URL in frontend/.env.local." />;
  }

  return (
    <main className="auth-shell">
      <AuthCard />
    </main>
  );
}

function AuthCard() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"email" | "password" | "create-password">("email");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (step === "email") {
        const state = await getPasswordState(email);

        if (!state.exists) {
          setError("This email is not enabled for admin access yet.");
          return;
        }

        setStep(state.hasPassword ? "password" : "create-password");
        return;
      }

      if (step === "create-password") {
        if (password !== confirmPassword) {
          setError("Passwords do not match");
          return;
        }

        await createPassword(email, password);
      }

      // Django analogy: Neon Auth owns the session cookie, like Django's auth login.
      // After this succeeds, our Worker verifies the JWT before serving admin routes.
      await signInAdmin(email, password);

      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not continue");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="auth-card">
      <p className="eyebrow">Admin</p>
      <h1>Sign in</h1>

      <form className="stack" onSubmit={submit}>
        <label>
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setPassword("");
              setConfirmPassword("");
              setStep("email");
            }}
            autoComplete="email"
            disabled={step !== "email"}
            required
          />
        </label>

        {step !== "email" && (
          <label>
            <span>{step === "create-password" ? "Create password" : "Password"}</span>
            <input
              type="password"
              value={password}
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={step === "create-password" ? "new-password" : "current-password"}
              required
            />
          </label>
        )}

        {step === "create-password" && (
          <label>
            <span>Confirm password</span>
            <input
              type="password"
              value={confirmPassword}
              minLength={8}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </label>
        )}

        {error && <p className="error">{error}</p>}

        <button className="button primary" type="submit" disabled={loading}>
          {loading ? "Checking..." : step === "email" ? "Next" : step === "create-password" ? "Create password" : "Sign in"}
        </button>
      </form>

      {step !== "email" && (
        <button className="link-button" type="button" onClick={() => setStep("email")}>
          Use a different email
        </button>
      )}
    </section>
  );
}

function AdminGate() {
  if (!isAuthConfigured()) {
    return <CenteredMessage title="Neon Auth is not configured" body="Set VITE_NEON_AUTH_URL in frontend/.env.local." />;
  }

  return <AdminSession />;
}

function AdminSession() {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAdminSession()
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <CenteredMessage title="Checking admin session" body="Loading your Neon Auth session." />;
  }

  if (!session) {
    window.history.replaceState(null, "", "/sign-in");
    return <AuthPage />;
  }

  return <AdminPage adminEmail={session.user.email} />;
}

function AdminPage({ adminEmail }: { adminEmail: string }) {
  const [guestUrl, setGuestUrl] = useState("");
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [pendingInvites, setPendingInvites] = useState<any[]>([]);
  const [selectedSubmission, setSelectedSubmission] = useState<any | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [submissionTab, setSubmissionTab] = useState<"pending" | "ready_for_review" | "done" | "rejected">("pending");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [verifiedAdmin, setVerifiedAdmin] = useState("");
  const [settingsStatus, setSettingsStatus] = useState<SettingsStatus | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [emailTemplate, setEmailTemplate] = useState<EmailTemplate | null>(null);
  const [emailTemplateDraft, setEmailTemplateDraft] = useState<EmailTemplate>({ subject: "", html: "" });
  const [emailTemplateSaving, setEmailTemplateSaving] = useState(false);

  async function refresh() {
    try {
      if (submissionTab === "pending") {
        const data = await listInvites();
        setPendingInvites(data.invites ?? []);
        setSubmissions([]);
        return;
      }

      const data = await listSubmissions(submissionTab);
      setSubmissions(data.submissions ?? []);
      setPendingInvites([]);
    } catch {
      setSubmissions([]);
      setPendingInvites([]);
    }
  }

  async function openSubmission(id: string) {
    setReviewLoading(true);
    setError("");
    setNotice("");
    try {
      const data = await getSubmission(id);
      setSelectedSubmission(data.submission);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load submission");
    } finally {
      setReviewLoading(false);
    }
  }

  async function confirmSelectedSubmission() {
    if (!selectedSubmission) return;

    setError("");
    setNotice("Queued in background. You can close this tab and return later to check if it succeeded.");
    try {
      const result = await confirmSubmission(selectedSubmission.id);
      const status = typeof result.status === "string" ? result.status : "queued";
      setSelectedSubmission((current: any) => current ? { ...current, status } : current);
      setNotice(
        result.alreadyRunning
          ? "Submission is already running in the background."
          : "Submission queued. Status will update automatically."
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not confirm submission");
      setNotice("Could not queue the submission. See the error below.");
    }
  }

  async function rejectSelectedSubmission() {
    if (!selectedSubmission) return;

    setReviewLoading(true);
    setError("");
    setNotice("");
    try {
      await rejectSubmission(selectedSubmission.id);
      setSelectedSubmission(null);
      setSubmissionTab("rejected");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reject submission");
    } finally {
      setReviewLoading(false);
    }
  }

  async function deleteSelectedSubmission() {
    if (!selectedSubmission) return;

    const ok = window.confirm("Delete this registration and its stored ID files? This cannot be undone.");
    if (!ok) return;

    setReviewLoading(true);
    setError("");
    setNotice("");

    try {
      await deleteSubmission(selectedSubmission.id);
      setSelectedSubmission(null);
      await refresh();
      setNotice("Registration deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete submission");
    } finally {
      setReviewLoading(false);
    }
  }

  async function deletePendingInvite(id: string) {
    const ok = window.confirm("Delete this pending link? Anyone opening it will see that it does not exist.");
    if (!ok) return;

    setReviewLoading(true);
    setError("");
    setNotice("");

    try {
      await deleteInvite(id);
      setPendingInvites((invites) => invites.filter((invite) => invite.id !== id));
      setNotice("Pending link deleted. It now does not exist.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete pending link");
    } finally {
      setReviewLoading(false);
    }
  }

  async function openLivePreview() {
    setError("");

    try {
      const preview = await getBrowserLivePreview();

      if (preview.available && preview.liveViewUrl) {
        window.open(preview.liveViewUrl, "_blank", "noopener,noreferrer");
        return;
      }

      setError(preview.error ?? "Live preview is not available right now.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open live preview");
    }
  }

  async function resetSubmitting() {
    if (!selectedSubmission) return;

    setReviewLoading(true);
    setError("");
    setNotice("");

    try {
      await resetSubmittingSubmission(selectedSubmission.id);
      const data = await getSubmission(selectedSubmission.id);
      setSelectedSubmission(data.submission);
      await refresh();
      setNotice("Reset to Ready for review. You can try Confirm again.");
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset submission");
    } finally {
      setReviewLoading(false);
    }
  }

  async function refreshSettings() {
    try {
      const [statusData, templateData] = await Promise.all([getSettingsStatus(), getEmailTemplate()]);
      setSettingsStatus(statusData);
      setEmailTemplate(templateData.template);
      setEmailTemplateDraft(templateData.template);
    } catch {
      setSettingsStatus(null);
    }
  }

  async function saveCurrentEmailTemplate() {
    setEmailTemplateSaving(true);
    setError("");
    setNotice("");

    try {
      const data = await saveEmailTemplate(emailTemplateDraft);
      setEmailTemplate(data.template);
      setEmailTemplateDraft(data.template);
      setNotice("Email template saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save email template");
    } finally {
      setEmailTemplateSaving(false);
    }
  }

  async function uploadGoogleSession(file: File) {
    setSettingsLoading(true);
    setError("");

    try {
      await uploadGoogleStorageState(file);
      await refreshSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload Google session");
    } finally {
      setSettingsLoading(false);
    }
  }

  async function checkGoogle() {
    setSettingsLoading(true);
    setError("");

    try {
      await checkGoogleSession();
      await refreshSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check Google session");
    } finally {
      setSettingsLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    void refreshSettings();
    getCurrentAdmin()
      .then((data) => setVerifiedAdmin(data.admin?.email ?? data.admin?.id ?? "Signed in"))
      .catch((err) => setError(err instanceof Error ? err.message : "Admin verification failed"));
  }, []);

  useEffect(() => {
    void refresh();
  }, [submissionTab]);

  useEffect(() => {
    if (!selectedSubmission || !isSubmittingStatus(selectedSubmission.status)) {
      return;
    }

    let cancelled = false;
    const submissionId = selectedSubmission.id as string;

    const poll = async () => {
      try {
        const data = await getSubmission(submissionId);
        if (cancelled) return;

        setSelectedSubmission(data.submission);

        if (!isSubmittingStatus(String(data.submission?.status ?? ""))) {
          if (data.submission?.status === "submitted_email_sent") {
            setNotice("Background submit finished and email was sent.");
          } else if (data.submission?.status === "submitted_email_failed") {
            setNotice("Background submit finished, but email failed. You can retry from this screen.");
          } else if (data.submission?.status === "failed") {
            setNotice("Background submit failed. Check the error details below.");
          } else if (data.submission?.status === "ready_for_review") {
            setNotice("Background submit was reset to Ready for review. You can run Confirm again.");
          }
          await refresh();
        }
      } catch {
        // Keep polling silently; intermittent network errors should not break the UI.
      }
    };

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, 8_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [selectedSubmission?.id, selectedSubmission?.status]);

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <h1>Generate a one-time guest registration link</h1>
          <p className="muted">Create the link, send it in guest chat, then review before submitting to the restricted PMO Google Form.</p>
        </div>
        <div className="admin-badge">
          <button className="status-chip" type="button" onClick={() => setShowSettings((value) => !value)}>
            <span className={googleStatusDotClass(settingsStatus)} />
            {googleStatusLabel(settingsStatus)}
          </button>
          <button className="icon-button" type="button" onClick={() => setShowSettings((value) => !value)} aria-label="Open settings">
            <Settings size={18} />
          </button>
          <span>{verifiedAdmin || adminEmail}</span>
          <button
            className="icon-button"
            onClick={async () => {
              await signOutAdmin();
              window.location.href = "/sign-in";
            }}
            aria-label="Sign out"
          >
            <LogOut size={18} />
          </button>
        </div>
      </section>

      {showSettings && (
        <section className="panel settings-panel">
          <div className="section-heading">
            <div>
              <h2>Settings</h2>
              <p className="muted">Upload and verify the local browser session used to fill the restricted PMO Google Form.</p>
            </div>
            <button className="button secondary" type="button" onClick={refreshSettings}>Refresh</button>
          </div>

          <div className="settings-grid">
            <div className="setting-card">
              <div className="setting-title">
                <span className={googleStatusDotClass(settingsStatus)} />
                <strong>Google browser session</strong>
              </div>
              <p className="muted">
                {settingsStatus?.hasStorageState
                  ? `${googleStatusLabel(settingsStatus)}${settingsStatus.connectedAt ? ` since ${formatDateTime(settingsStatus.connectedAt)}` : ""}.`
                  : "No local browser session uploaded yet."}
              </p>
              {settingsStatus?.lastCheck && (
                <p className="muted">
                  Last check: {formatDateTime(settingsStatus.lastCheck.checkedAt)}. {settingsStatus.lastCheck.message}
                </p>
              )}
              <div className="actions inline-actions">
                <label className="button primary file-button">
                  <Upload size={16} />
                  Upload storage state
                  <input
                    type="file"
                    accept="application/json,.json"
                    disabled={settingsLoading}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (file) void uploadGoogleSession(file);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                <button className="button secondary" type="button" onClick={checkGoogle} disabled={settingsLoading || !settingsStatus?.hasStorageState}>
                  {settingsLoading ? "Checking..." : "Check session"}
                </button>
              </div>
              <p className="muted helper-text">
                Export a Playwright storageState JSON from your normal logged-in browser, upload it here, then run Check session.
              </p>
            </div>

            <div className="setting-card">
              <div className="setting-title">
                <span className={settingsStatus?.email.configured ? "status-dot warning" : "status-dot"} />
                <strong>Gmail SMTP</strong>
              </div>
              <p className="muted">
                {settingsStatus?.email.configured
                  ? "Credentials are present. Confirm will email the entrance pass screenshot after Google accepts the form."
                  : "Not configured. Add Gmail SMTP credentials before we enable email forwarding."}
              </p>
            </div>

            <div className="setting-card email-template-card">
              <div className="setting-title">
                <span className="status-dot connected" />
                <strong>Guest email template</strong>
              </div>
              <p className="muted">
                This HTML is sent to the guest with the PMO entrance-pass screenshot attached after Confirm succeeds.
              </p>
              <label>
                <span>Subject</span>
                <input
                  value={emailTemplateDraft.subject}
                  onChange={(event) => setEmailTemplateDraft((current) => ({ ...current, subject: event.target.value }))}
                  placeholder="Email subject"
                />
              </label>
              <label className="email-template-editor">
                <span>HTML body</span>
                <textarea
                  value={emailTemplateDraft.html}
                  onChange={(event) => setEmailTemplateDraft((current) => ({ ...current, html: event.target.value }))}
                  placeholder="Write the guest email HTML here"
                />
              </label>
              <div className="actions inline-actions">
                <button className="button primary" type="button" onClick={saveCurrentEmailTemplate} disabled={emailTemplateSaving}>
                  {emailTemplateSaving ? "Saving..." : "Save email template"}
                </button>
                {emailTemplate && (
                  <button className="button secondary" type="button" onClick={() => setEmailTemplateDraft(emailTemplate)}>
                    Undo edits
                  </button>
                )}
              </div>
              {emailTemplateDraft.html && (
                <details className="email-preview-wrap">
                  <summary>Preview email</summary>
                  <div className="email-preview" dangerouslySetInnerHTML={{ __html: emailTemplateDraft.html }} />
                </details>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="panel">
        <Formik
          initialValues={{ checkIn: "", checkOut: "" }}
          onSubmit={async (values, helpers) => {
            setError("");
            try {
              const result = await createInvite(values);
              const inviteData = await listInvites();
              setGuestUrl(result.guestUrl);
              setSubmissionTab("pending");
              setPendingInvites(inviteData.invites ?? []);
              setSubmissions([]);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not create invite");
            } finally {
              helpers.setSubmitting(false);
            }
          }}
        >
          {({ values, handleChange, isSubmitting }) => (
            <Form className="grid-form">
              <label>
                <span>Check in</span>
                <input name="checkIn" type="date" value={values.checkIn} onChange={handleChange} required />
              </label>
              <label>
                <span>Check out</span>
                <input name="checkOut" type="date" value={values.checkOut} onChange={handleChange} required />
              </label>
              <button className="button primary" type="submit" disabled={isSubmitting}>
                <CalendarDays size={18} /> Generate link
              </button>
            </Form>
          )}
        </Formik>

	        {error && <p className="error">{error}</p>}
	        {notice && <p className="notice">{notice}</p>}
	        {guestUrl && (
          <div className="copy-box">
            <span>{guestUrl}</span>
            <button className="icon-button" onClick={() => navigator.clipboard.writeText(guestUrl)} aria-label="Copy invite URL">
              <Copy size={18} />
            </button>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="section-heading">
          <h2>Recent submissions</h2>
          <button className="button secondary" onClick={refresh}>Refresh</button>
        </div>
        <div className="tabs">
          <button className={submissionTab === "pending" ? "active" : ""} type="button" onClick={() => setSubmissionTab("pending")}>
            Pending
          </button>
          <button className={submissionTab === "ready_for_review" ? "active" : ""} type="button" onClick={() => setSubmissionTab("ready_for_review")}>
            Ready for review
          </button>
          <button className={submissionTab === "done" ? "active" : ""} type="button" onClick={() => setSubmissionTab("done")}>
            Done
          </button>
          <button className={submissionTab === "rejected" ? "active" : ""} type="button" onClick={() => setSubmissionTab("rejected")}>
            Rejected
          </button>
        </div>
        <div className="table-list">
          {submissionTab === "pending" && pendingInvites.length === 0 ? (
            <p className="muted">No pending links.</p>
          ) : submissionTab === "pending" ? (
            pendingInvites.map((invite) => (
              <div className="row-card" key={invite.id}>
                <div className="row-main pending-invite-details">
                  <strong>{formatDate(invite.checkIn)} to {formatDate(invite.checkOut)}</strong>
                  <span>Expires {formatDateTime(invite.expiresAt)}</span>
                  {invite.guestUrl ? (
                    <span className="breakable">{invite.guestUrl}</span>
                  ) : (
                    <span>URL unavailable for older hashed-only invite</span>
                  )}
                </div>
                <div className="row-actions">
                  <span className="pill">{formatStatus(invite.status)}</span>
                  {invite.guestUrl && (
                    <button className="icon-button" type="button" onClick={() => navigator.clipboard.writeText(invite.guestUrl)} aria-label="Copy invite URL">
                      <Copy size={18} />
                    </button>
                  )}
                  <button className="icon-button danger" type="button" onClick={() => deletePendingInvite(invite.id)} disabled={reviewLoading} aria-label="Delete pending invite">
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            ))
          ) : submissions.length === 0 ? (
            <p className="muted">No submissions yet.</p>
          ) : (
            submissions.map((submission) => (
              <button className="row-card row-button" key={submission.id} type="button" onClick={() => openSubmission(submission.id)}>
                <div className="row-main">
                  <strong>{submission.guest_email}</strong>
                  <span>{formatDate(submission.check_in)} to {formatDate(submission.check_out)}</span>
                </div>
                <span className="pill">{formatStatus(submission.status)}</span>
              </button>
            ))
          )}
        </div>
      </section>

      {selectedSubmission && (
        <section className="panel review-panel">
          <div className="section-heading">
            <div>
              <h2>Review registration</h2>
              <p className="muted">{selectedSubmission.guest_email}</p>
            </div>
            <button className="button secondary" type="button" onClick={() => setSelectedSubmission(null)}>Close</button>
          </div>

          <div className="review-grid">
            <ReviewLine label="Stay" value={`${formatDate(selectedSubmission.check_in)} to ${formatDate(selectedSubmission.check_out)}`} />
            <ReviewLine label="Status" value={formatStatus(selectedSubmission.status)} />
          </div>

          <div className="guest-review-list">
            {selectedSubmission.guests.map((guest: any, index: number) => (
              <div className="guest-review-card" key={guest.id ?? index}>
                <strong>{guest.fullName}</strong>
                <span>Age {guest.age}</span>
                <span>{guest.requiresId ? `${guest.files?.length ?? 0} ID file(s)` : "No ID needed"}</span>
                {guest.files?.length > 0 && (
                  <div className="file-list">
                    {guest.files.map((file: any, fileIndex: number) => (
                      <IdPreview
                        key={`${file.filename}-${fileIndex}`}
                        file={file}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

	          <div className="actions">
	            <button className="button secondary" type="button" onClick={() => setSelectedSubmission(null)}>Back</button>
	            <button className="button danger" type="button" onClick={deleteSelectedSubmission} disabled={reviewLoading}>
	              <Trash2 size={16} /> Delete
	            </button>
		            {isSubmittingStatus(selectedSubmission.status) && (
		              <>
		                <button className="button secondary" type="button" onClick={openLivePreview}>
		                  <Eye size={16} /> Live preview
		                </button>
		                <button className="button secondary" type="button" onClick={resetSubmitting} disabled={reviewLoading}>
		                  Reset
		                </button>
		              </>
		            )}
		            {!["rejected", "submitted_email_sent"].includes(selectedSubmission.status) && !isSubmittingStatus(selectedSubmission.status) && (
		              <>
	                <button className="button danger" type="button" onClick={rejectSelectedSubmission} disabled={reviewLoading}>
	                  Reject
	                </button>
	                <button className="button primary" type="button" onClick={confirmSelectedSubmission} disabled={reviewLoading || isSubmittingStatus(selectedSubmission.status)}>
	                  {reviewLoading ? "Confirming..." : "Confirm registration"}
	                </button>
	              </>
	            )}
	          </div>
	          {notice && <p className="notice">{notice}</p>}
	          {error && <p className="error">{error}</p>}
	        </section>
      )}

      {reviewLoading && !selectedSubmission && <p className="muted">Loading registration...</p>}
    </main>
  );
}

function GuestFlow({ token }: { token: string }) {
  const [invite, setInvite] = useState<InviteState | null>(null);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [uploadingFile, setUploadingFile] = useState("");
  const [idPreviews, setIdPreviews] = useState<Record<string, LocalIdPreview>>({});
  const previewUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    getInvite(token).then(setInvite).catch((err) => setError(err.message));
  }, [token]);

  useEffect(() => {
    return () => {
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrlsRef.current = [];
    };
  }, []);

  const steps = useMemo(() => ["Email", "Guests", "Review"], []);

  if (error) {
    return <CenteredMessage title="This link is not available" body={error} />;
  }

  if (!invite) {
    return <CenteredMessage title="Loading registration" body="Checking your one-time link." />;
  }

  if (done) {
    return <CenteredMessage title="Registration received" body="Your host will review it and submit the PMO registration." />;
  }

  const initialValues: GuestFormValues = {
    guestEmail: "",
    purpose: "Tenant",
    guests: [{ fullName: "", age: 18 }],
    acceptedRules: false
  };

  return (
    <main className="shell compact">
      <section className="hero">
        <div>
          <p className="eyebrow">Cozy Davao D-714 tenant registration</p>
          <h1>{formatDate(invite.checkIn)} to {formatDate(invite.checkOut)}</h1>
          <p className="muted">Building {invite.buildingCode}, Unit {invite.unitNumber}</p>
        </div>
      </section>

      <div className="steps">
        {steps.map((label, index) => (
          <span className={index <= step ? "active" : ""} key={label}>{label}</span>
        ))}
      </div>

      <Formik
        initialValues={initialValues}
        onSubmit={async (values, helpers) => {
          setError("");
          if (!values.acceptedRules) {
            setError("Please confirm the information is accurate before submitting.");
            helpers.setSubmitting(false);
            return;
          }

          try {
            await submitGuestForm(token, { ...values, purpose: "Tenant", acceptedRules: true });
            setDone(true);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not submit registration");
          } finally {
            helpers.setSubmitting(false);
          }
        }}
      >
        {({ values, handleChange, setFieldValue, submitForm, isSubmitting }) => (
          <Form className="panel">
            {step === 0 && (
              <div className="stack email-step">
                <label>
                  <span>Email for entrance pass</span>
                  <input name="guestEmail" type="email" value={values.guestEmail} onChange={handleChange} required />
                </label>
              </div>
            )}

            {step === 1 && (
              <FieldArray name="guests">
                {({ push, remove }) => (
                  <div className="stack">
                    {values.guests.map((guest, index) => (
                      <div className="guest-card" key={index}>
                        <label>
                          <span>Guest {index + 1} name</span>
                          <input name={`guests.${index}.fullName`} value={guest.fullName} onChange={handleChange} required />
                        </label>
                        <label>
                          <span>Age</span>
                          <input name={`guests.${index}.age`} type="number" min="0" value={guest.age} onChange={handleChange} required />
                        </label>
                        {Number(guest.age) >= invite.minorIdCutoff && (
                          <label>
                            <span>Valid ID</span>
                            <input
                              type="file"
                              onChange={async (event) => {
                                const file = event.currentTarget.files?.[0];
                                if (!file) return;

                                setUploadingFile(file.name);
                                setError("");
                                const previewUrl = URL.createObjectURL(file);
                                previewUrlsRef.current.push(previewUrl);

                                try {
                                  const uploaded = await uploadGuestFile(token, file);
                                  const previousKey = guest.idFileKey;
                                  if (previousKey && idPreviews[previousKey]) {
                                    URL.revokeObjectURL(idPreviews[previousKey].url);
                                  }

                                  setFieldValue(`guests.${index}.idFileKey`, uploaded.key);
                                  setIdPreviews((current) => {
                                    const next = { ...current };
                                    if (previousKey) delete next[previousKey];
                                    next[uploaded.key] = {
                                      url: previewUrl,
                                      filename: file.name,
                                      contentType: file.type || "application/octet-stream"
                                    };
                                    return next;
                                  });
                                } catch (err) {
                                  URL.revokeObjectURL(previewUrl);
                                  setError(err instanceof Error ? err.message : "Could not upload file");
                                } finally {
                                  setUploadingFile("");
                                  event.currentTarget.value = "";
                                }
                              }}
                            />
                          </label>
                        )}
                        {guest.idFileKey && idPreviews[guest.idFileKey] && (
                          <LocalIdPreviewCard preview={idPreviews[guest.idFileKey]} />
                        )}
                        {values.guests.length > 1 && (
                          <button
                            className="button danger"
                            type="button"
                            onClick={() => {
                              if (guest.idFileKey && idPreviews[guest.idFileKey]) {
                                URL.revokeObjectURL(idPreviews[guest.idFileKey].url);
                                setIdPreviews((current) => {
                                  const next = { ...current };
                                  delete next[guest.idFileKey as string];
                                  return next;
                                });
                              }
                              remove(index);
                            }}
                          >
                            <Trash2 size={16} /> Remove
                          </button>
                        )}
                      </div>
                    ))}
                    {uploadingFile && <p className="muted">Uploading {uploadingFile}...</p>}
                    {values.guests.length < 10 && (
                      <button className="button secondary" type="button" onClick={() => push({ fullName: "", age: 18 })}>
                        <Plus size={16} /> Add guest
                      </button>
                    )}
                  </div>
                )}
              </FieldArray>
            )}

            {step === 2 && (
              <div className="stack">
                <ReviewLine label="Email" value={values.guestEmail} />
                {values.guests.map((guest, index) => (
                  <div className="review-guest-block" key={index}>
                    <ReviewLine label={`Guest ${index + 1}`} value={`${guest.fullName}, age ${guest.age}`} />
                    {guest.idFileKey && idPreviews[guest.idFileKey] && (
                      <LocalIdPreviewCard preview={idPreviews[guest.idFileKey]} compact />
                    )}
                  </div>
                ))}
                <label className="check-row">
                  <input name="acceptedRules" type="checkbox" checked={values.acceptedRules} onChange={handleChange} />
                  <span>I confirm the information is accurate and agree to follow the condo rules.</span>
                </label>
              </div>
            )}

            {error && <p className="error">{error}</p>}

            <div className="actions">
              {step > 0 && <button className="button secondary" type="button" onClick={() => setStep(step - 1)}>Back</button>}
              {step < steps.length - 1 ? (
                <button
                  className="button primary"
                  type="button"
                  onClick={() => {
                    setError("");

                    if (step === 0 && !values.guestEmail.trim()) {
                      setError("Email is required so we can send the entrance pass.");
                      return;
                    }

                    const missingGuest = values.guests.find((guest) => !guest.fullName.trim());
                    if (step === 1 && missingGuest) {
                      setError("Please add the name of each guest.");
                      return;
                    }

                    const missingId = values.guests.find((guest) => Number(guest.age) >= invite.minorIdCutoff && !guest.idFileKey);
                    if (step === 1 && missingId) {
                      setError(`Please upload a valid ID for ${missingId.fullName || "each adult guest"}.`);
                      return;
                    }

                    setStep(step + 1);
                  }}
                >
                  Next
                </button>
              ) : (
                <button
                  className="button primary"
                  type="button"
                  disabled={isSubmitting || !values.acceptedRules}
                  onClick={() => void submitForm()}
                >
                  <Send size={16} /> Submit registration
                </button>
              )}
            </div>
          </Form>
        )}
      </Formik>
    </main>
  );
}

function ReviewLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="review-line">
      <span>{label}</span>
      <strong>{value || "Not provided"}</strong>
    </div>
  );
}

function LocalIdPreviewCard({ preview, compact = false }: { preview: LocalIdPreview; compact?: boolean }) {
  const isImage = preview.contentType.startsWith("image/");

  return (
    <button
      className={`id-preview local-id-preview${compact ? " compact-preview" : ""}`}
      type="button"
      onClick={() => window.open(preview.url, "_blank", "noopener,noreferrer")}
      aria-label={`Open ${preview.filename}`}
    >
      {isImage ? (
        <img src={preview.url} alt={preview.filename} />
      ) : (
        <iframe src={preview.url} title={preview.filename} />
      )}
      <span>{preview.filename}</span>
    </button>
  );
}

function IdPreview({ file }: { file: any }) {
  const [url, setUrl] = useState("");
  const [missing, setMissing] = useState(false);
  const isImage = String(file.contentType ?? "").startsWith("image/");

  useEffect(() => {
    let objectUrl = "";
    let cancelled = false;

    getAdminFileUrl(file.url)
      .then((fileUrl) => fetch(fileUrl, { cache: "no-store" }))
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("ID deleted");
        }

        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.url]);

  if (missing) {
    return (
      <div className="id-preview id-preview-missing">
        <span>ID deleted</span>
        <small>{file.filename}</small>
      </div>
    );
  }

  if (!url) {
    return <div className="id-preview loading">Loading ID preview...</div>;
  }

  return (
    <button
      className="id-preview"
      type="button"
      onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
      aria-label={`Open ${file.filename}`}
    >
      {isImage ? (
        <img src={url} alt={file.filename} />
      ) : (
        <iframe src={url} title={file.filename} />
      )}
      <span>{file.filename}</span>
    </button>
  );
}

function CenteredMessage({ title, body }: { title: string; body: string }) {
  return (
    <main className="centered">
      <div className="success-mark"><Check size={28} /></div>
      <h1>{title}</h1>
      <p>{body}</p>
    </main>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatStatus(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function googleStatusLabel(status: SettingsStatus | null) {
  if (!status?.hasStorageState) return "Google not connected";
  if (status.expired) return "Google expired";
  if (status.connected) return "Google connected";
  return "Google needs check";
}

function googleStatusDotClass(status: SettingsStatus | null) {
  if (status?.connected) return "status-dot connected";
  if (status?.expired || status?.hasStorageState) return "status-dot warning";
  return "status-dot";
}

function isSubmittingStatus(status: string) {
  return status === "queued" || status === "submitting";
}
