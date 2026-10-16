import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ApiError } from "../lib/api";
import { useAuthActions, useSession } from "../lib/auth";
import { useDocumentTitle } from "../lib/hooks";
import { formatDate, pluralize } from "../lib/format";
import { useLibrary } from "../lib/library";
import { toast } from "../lib/toast";
import { AsteriskMark } from "./AsteriskIcon";

export function AccountPage() {
  const { user, isLoading } = useSession();
  const { updateName, signOutEverywhere, deleteAccount } = useAuthActions();
  const library = useLibrary(user);
  const navigate = useNavigate();
  const [name, setName] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [deleteError, setDeleteError] = useState("");
  useDocumentTitle("Account");

  if (isLoading) return null;

  if (!user) {
    return (
      <section className="message-page">
        <AsteriskMark size={48} />
        <h1>Sign in to manage your account</h1>
        <div className="message-actions">
          <Link to="/signin" search={{ redirect: "/account" }} className="btn btn-primary">
            Sign in
          </Link>
        </div>
      </section>
    );
  }

  const currentName = name ?? user.name;
  const { bookmarks, highlights, history } = library.snapshot;

  return (
    <div className="container" style={{ maxWidth: 680 }}>
      <header className="page-head">
        <h1 className="page-title">Account</h1>
        <p className="page-sub">
          Signed in as {user.email} · member since {formatDate(user.createdAt)}
        </p>
      </header>

      <div className="settings">
        <section className="settings-card">
          <h2>Profile</h2>
          <p>The name shown in your account menu.</p>
          <form
            className="settings-row"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!currentName.trim() || currentName.trim() === user.name) return;
              setSavingName(true);
              try {
                await updateName(currentName.trim());
                setName(null);
                toast("Name updated", { tone: "success" });
              } catch (error) {
                toast(error instanceof ApiError ? error.message : "Couldn't update your name.", { tone: "error" });
              } finally {
                setSavingName(false);
              }
            }}
          >
            <div className="field">
              <label className="field-label" htmlFor="account-name">
                Name
              </label>
              <input id="account-name" className="input" value={currentName} maxLength={60} onChange={(event) => setName(event.target.value)} />
            </div>
            <button type="submit" className="btn btn-primary" disabled={savingName || !currentName.trim() || currentName.trim() === user.name}>
              Save
            </button>
          </form>
        </section>

        <section className="settings-card">
          <h2>Your library</h2>
          <p>
            {pluralize(bookmarks.length, "saved article")}, {pluralize(highlights.length, "highlight")} and {pluralize(history.length, "article")} in your history.
          </p>
          <Link to="/library" className="btn btn-secondary">
            Open library
          </Link>
        </section>

        <section className="settings-card">
          <h2>Sessions</h2>
          <p>Signed in on a shared or lost device? Sign out everywhere, including here.</p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={async () => {
              await signOutEverywhere();
              toast("Signed out on every device");
              navigate({ to: "/" });
            }}
          >
            Sign out everywhere
          </button>
        </section>

        <section className="settings-card danger">
          <h2>Delete account</h2>
          <p>Permanently removes your account, highlights, notes, saved articles and history. This can't be undone.</p>
          {confirming ? (
            <form
              className="settings-row"
              onSubmit={async (event) => {
                event.preventDefault();
                setDeleteError("");
                try {
                  await deleteAccount(password);
                  toast("Your account has been deleted.");
                  navigate({ to: "/" });
                } catch (error) {
                  setDeleteError(error instanceof ApiError ? error.message : "Couldn't delete your account.");
                }
              }}
            >
              <div className="field">
                <label className="field-label" htmlFor="delete-password">
                  Confirm with your password
                </label>
                <input
                  id="delete-password"
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-invalid={Boolean(deleteError)}
                  autoFocus
                />
                {deleteError && <span className="field-error">{deleteError}</span>}
              </div>
              <button type="submit" className="btn btn-danger" disabled={!password}>
                Delete forever
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <button type="button" className="btn btn-danger" onClick={() => setConfirming(true)}>
              Delete my account
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
