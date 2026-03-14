import {
  appModal,
  appModalCancelBtn,
  appModalConfirmBtn,
  appModalInput,
  appModalMessage,
  appModalTitle,
} from "./dom.ts";

type ModalState =
  | { type: "idle" }
  | { type: "notice"; resolve: () => void }
  | { type: "prompt"; resolve: (value: string | null) => void };

let modalState: ModalState = { type: "idle" };

function resetModal() {
  appModal.classList.add("hidden");
  appModalTitle.textContent = "Notice";
  appModalMessage.textContent = "";
  appModalMessage.classList.add("hidden");
  appModalInput.value = "";
  appModalInput.classList.add("hidden");
  appModalCancelBtn.textContent = "Cancel";
  appModalCancelBtn.classList.add("hidden");
  appModalConfirmBtn.textContent = "OK";
}

function settleModal(confirmed: boolean) {
  const currentState = modalState;
  if (currentState.type === "idle") return;

  const inputValue = appModalInput.value;
  modalState = { type: "idle" };
  resetModal();

  if (currentState.type === "notice") {
    currentState.resolve();
    return;
  }

  currentState.resolve(confirmed ? inputValue : null);
}

type PromptOptions = {
  title: string;
  defaultValue: string;
  confirmLabel?: string;
  cancelLabel?: string;
  message?: string;
};

type NoticeOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
};

export function showPromptModal({
  title,
  defaultValue,
  confirmLabel = "Save",
  cancelLabel = "Cancel",
  message = "",
}: PromptOptions): Promise<string | null> {
  settleModal(false);

  appModalTitle.textContent = title;
  appModalConfirmBtn.textContent = confirmLabel;
  appModalCancelBtn.textContent = cancelLabel;
  appModalCancelBtn.classList.remove("hidden");
  appModalInput.classList.remove("hidden");
  appModalInput.value = defaultValue;

  if (message) {
    appModalMessage.textContent = message;
    appModalMessage.classList.remove("hidden");
  } else {
    appModalMessage.textContent = "";
    appModalMessage.classList.add("hidden");
  }

  appModal.classList.remove("hidden");

  return new Promise((resolve) => {
    modalState = { type: "prompt", resolve };
    appModalInput.focus();
    appModalInput.select();
  });
}

export function showMessageModal({
  title,
  message,
  confirmLabel = "OK",
}: NoticeOptions): Promise<void> {
  settleModal(false);

  appModalTitle.textContent = title;
  appModalMessage.textContent = message;
  appModalMessage.classList.remove("hidden");
  appModalConfirmBtn.textContent = confirmLabel;
  appModalInput.classList.add("hidden");
  appModalCancelBtn.classList.add("hidden");
  appModal.classList.remove("hidden");

  return new Promise((resolve) => {
    modalState = { type: "notice", resolve };
    appModalConfirmBtn.focus();
  });
}

export function setupModalListeners() {
  appModalCancelBtn.addEventListener("click", () => settleModal(false));
  appModalConfirmBtn.addEventListener("click", () => settleModal(true));

  appModal.addEventListener("click", (e) => {
    if (e.target === appModal) {
      settleModal(false);
    }
  });

  appModal.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      settleModal(false);
    }
  });

  appModalInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      settleModal(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      settleModal(false);
    }
  });
}
