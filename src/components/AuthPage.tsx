import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ApiError } from "../lib/api";
import { useAuthActions, useSession } from "../lib/auth";
import { pluralize } from "../lib/format";
import { toast } from "../lib/toast";
import { AsteriskMark } from "./AsteriskIcon";
import { Icon } from "./Icon";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Only follow redirects back into this app. */
function safeRedirect(value: string | undefined): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/signin") && !value.startsWith("/signup") ? value : "/";
}

export function AuthPage({ mode, redirect }: { mode: "signin" | "signup"; redirect?: string }) {
  const { user } = useSession();
  const { signIn, signUp } = useAuthActions();
  const navigate = useNavigate();
  const isSignUp = mode === "signup";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const target = safeRedirect(redirect);

  // Already signed in (e.g. opened the page in another tab): move along.
  useEffect(() => {
    if (user && !submitting) navigate({ to: target, replace: true });
  }, [user, submitting, navigate, target]);

  const errors = {
    name: isSignUp && !name.trim() ? "Tell us what to call you." : "",
    email: !EMAIL_PATTERN.test(email.trim()) ? "Enter a valid email address." : "",
    password: isSignUp && password.length < 8 ? "Use at least 8 characters." : !isSignUp && !password ? "Enter your password." : "",
  };
  const hasErrors = Object.values(errors).some(Boolean);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setTouched({ name: true, email: true, password: true });
    setFormError("");
    if (hasErrors) return;

    setSubmitting(true);
    try {
      const result = isSignUp ? await signUp(name.trim(), email.trim(), password) : await signIn(email.trim(), password);
      toast(
        result.imported > 0
          ? `Welcome, ${result.user.name}. ${pluralize(result.imported, "item")} from this browser moved into your account.`
          : isSignUp
            ? `Welcome, ${result.user.name}. Your library now syncs everywhere.`
            : `Welcome back, ${result.user.name}.`,
        { tone: "success", duration: 4500 }
      );
      navigate({ to: target, replace: true });
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const fieldError = (field: keyof typeof errors) => (touched[field] ? errors[field] : "");

  return (
    <section className="auth-page">
      <div className="auth-card rise">
        <div className="brand-mark">
          <AsteriskMark size={26} />
        </div>
        <h1>{isSignUp ? "Create your account" : "Welcome back"}</h1>
        <p className="lede">
          {isSignUp ? "Free, no newsletter. Your highlights, notes and reading list follow you to every device." : "Sign in to pick up where you left off."}
        </p>

        <form className="auth-form" onSubmit={onSubmit} noValidate>
          {formError && (
            <div className="form-alert" role="alert">
              <Icon name="x" size={18} />
              <span>{formError}</span>
            </div>
          )}

          {isSignUp && (
            <div className="field">
              <label className="field-label" htmlFor="auth-name">
                Name
              </label>
              <input
                id="auth-name"
                className="input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onBlur={() => setTouched((value) => ({ ...value, name: true }))}
                autoComplete="name"
                aria-invalid={Boolean(fieldError("name"))}
                aria-describedby="auth-name-error"
                maxLength={60}
                autoFocus
              />
              <span id="auth-name-error" className="field-error">
                {fieldError("name")}
              </span>
            </div>
          )}

          <div className="field">
            <label className="field-label" htmlFor="auth-email">
              Email
            </label>
            <input
              id="auth-email"
              className="input"
              type="email"
              inputMode="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onBlur={() => setTouched((value) => ({ ...value, email: true }))}
              autoComplete="email"
              aria-invalid={Boolean(fieldError("email"))}
              aria-describedby="auth-email-error"
              autoFocus={!isSignUp}
            />
            <span id="auth-email-error" className="field-error">
              {fieldError("email")}
            </span>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="auth-password">
              Password
            </label>
            <div className="input-group">
              <input
                id="auth-password"
                className="input"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onBlur={() => setTouched((value) => ({ ...value, password: true }))}
                autoComplete={isSignUp ? "new-password" : "current-password"}
                aria-invalid={Boolean(fieldError("password"))}
                aria-describedby="auth-password-hint"
                maxLength={128}
              />
              <button type="button" className="btn btn-ghost btn-sm input-action" onClick={() => setShowPassword((value) => !value)}>
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            <span id="auth-password-hint" className={fieldError("password") ? "field-error" : "field-hint"}>
              {fieldError("password") || (isSignUp ? "At least 8 characters. A short sentence works well." : "")}
            </span>
          </div>

          <button type="submit" className="btn btn-primary btn-block" style={{ height: 46 }} disabled={submitting}>
            {submitting && <span className="spinner" aria-hidden="true" />}
            {isSignUp ? "Create account" : "Sign in"}
          </button>
        </form>

        <p className="auth-switch">
          {isSignUp ? "Already have an account? " : "New here? "}
          <Link to={isSignUp ? "/signin" : "/signup"} search={{ redirect }} className="text-link">
            {isSignUp ? "Sign in" : "Create an account"}
          </Link>
        </p>

        {isSignUp && (
          <ul className="auth-perks">
            <li>
              <Icon name="check" size={17} /> Highlights and notes synced across devices
            </li>
            <li>
              <Icon name="check" size={17} /> Your reading list and history, with your place saved
            </li>
            <li>
              <Icon name="check" size={17} /> Anything you saved as a guest comes with you
            </li>
          </ul>
        )}
      </div>
    </section>
  );
}
