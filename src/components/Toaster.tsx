import { dismissToast, useToasts } from "../lib/toast";
import { Icon } from "./Icon";

export function Toaster() {
  const toasts = useToasts();
  return (
    <div className="toaster" role="status" aria-live="polite">
      {toasts.map((item) => (
        <div key={item.id} className={`toast ${item.tone}`}>
          {item.tone === "success" && <Icon name="check" size={17} className="toast-icon" />}
          <span>{item.message}</span>
          {item.action && (
            <button
              type="button"
              onClick={() => {
                item.action?.onClick();
                dismissToast(item.id);
              }}
            >
              {item.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
