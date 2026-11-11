/* eslint-disable @nx/enforce-module-boundaries */
import { mock } from "jest-mock-extended";
import { KeyPair } from "@near-js/crypto";
import { mockWallet } from "../../../core/src/lib/testUtils";

import type { MockWalletDependencies } from "../../../core/src/lib/testUtils";
import { setupNarwallets } from "./narwallets";
import type {
  InjectedWallet,
  SignMessageParams,
  StorageService,
} from "@near-wallet-selector/core";

const accountId = "test-account.testnet";
const transactions = [
  {
    signerId: accountId,
    receiverId: "test.testnet",
    actions: [],
  },
  {
    signerId: accountId,
    receiverId: "test.testnet",
    actions: [],
  },
];

const mockNarWalletOnWindow = () => {
  window.postMessage = jest.fn();
  window.narwallets = mock<InjectedWallet>();

  return window.narwallets;
};

const createNarWallet = async (deps: MockWalletDependencies = {}) => {
  const injectedNarWallet = mockNarWalletOnWindow();
  const { wallet } = await mockWallet<InjectedWallet>(setupNarwallets(), deps);

  return {
    wallet,
    injectedNarWallet,
  };
};

afterEach(() => {
  jest.resetModules();
});

describe("signIn", () => {
  it.skip("sign into nar wallet", async () => {
    const { wallet, injectedNarWallet } = await createNarWallet();

    const accounts = await wallet.signIn({ contractId: "test.testnet" });

    expect(injectedNarWallet.signIn).toHaveBeenCalled();
    expect(accounts).toEqual([{ accountId, publicKey: undefined }]);
  });
});

describe("signOut", () => {
  it.skip("sign out of nar wallet", async () => {
    const { wallet, injectedNarWallet } = await createNarWallet();

    await wallet.signIn({ contractId: "test.testnet" });
    await wallet.signOut();

    expect(injectedNarWallet.signOut).toHaveBeenCalled();
  });
});

describe("getAccounts", () => {
  it.skip("returns array of accounts", async () => {
    const { wallet, injectedNarWallet } = await createNarWallet();

    await wallet.signIn({ contractId: "test.testnet" });
    const result = await wallet.getAccounts();

    expect(injectedNarWallet.getAccounts).toHaveBeenCalled();
    expect(result).toEqual([{ accountId, publicKey: undefined }]);
  });
});

describe("signAndSendTransaction", () => {
  it.skip("sign transaction in nar wallet", async () => {
    const { wallet, injectedNarWallet } = await createNarWallet();

    await wallet.signIn({ contractId: "test.testnet" });
    await wallet.signAndSendTransaction({
      signerId: accountId,
      receiverId: "test.testnet",
      actions: [],
    });

    expect(injectedNarWallet.signAndSendTransaction).toHaveBeenCalled();
  });
});
describe("signAndSendTransactions", () => {
  it.skip("sign transactions in nar wallet", async () => {
    const { wallet, injectedNarWallet } = await createNarWallet();

    await wallet.signIn({ contractId: "test.testnet" });
    const result = await wallet.signAndSendTransactions({
      transactions,
    });

    expect(injectedNarWallet.signAndSendTransactions).toHaveBeenCalled();
    expect(result.length).toEqual(transactions.length);
  });
});

const signedAccountId = "test-account.testnet";
const keyPair = KeyPair.fromRandom("ed25519");
const publicKey = keyPair.getPublicKey().toString();
const signature = Buffer.alloc(64, 3).toString("base64");

const createStorage = (
  initial: Record<string, string> = {}
): StorageService => {
  const state = { ...initial };
  return {
    getItem: jest.fn(async (key) => state[key] ?? null),
    setItem: jest.fn(async (key, value) => {
      state[key] = value;
    }),
    removeItem: jest.fn(async (key) => {
      delete state[key];
    }),
  };
};

const installNarwalletsBridge = () => {
  const posted: Array<{
    id: number;
    code?: string;
    dest?: string;
    params?: { nonce?: Array<number>; accountId?: string };
  }> = [];

  window.narwallets = mock<InjectedWallet>();
  window.postMessage = ((data: unknown) => {
    const message = data as typeof posted[number];
    posted.push(message);
    if (message?.dest !== "ext") {
      return;
    }

    let result: unknown = true;
    if (message.code === "get-account-id" || message.code === "sign-in") {
      result = signedAccountId;
    } else if (message.code === "sign-message") {
      result = {
        accountId: signedAccountId,
        publicKey,
        signature,
        state: "returned-state",
      };
    }

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          id: message.id,
          type: "nw",
          dest: "page",
          result: { data: result },
        },
        source: window,
      })
    );
  }) as typeof window.postMessage;

  return posted;
};

const signedInNarWallet = () => {
  return mockWallet(setupNarwallets(), {
    // resolveOptions reads storage from this object. Options itself does not declare it.
    options: {
      storage: createStorage({
        "near-wallet-selector:selectedWalletId": JSON.stringify("narwallets"),
      }),
    } as unknown as MockWalletDependencies["options"],
  });
};

const signMessageParams: SignMessageParams = {
  message: "authorize node studio",
  recipient: "node-studio.near",
  nonce: Buffer.alloc(32, 7),
  callbackUrl: "https://example.com/callback",
  state: "request-state",
};

describe("signMessage", () => {
  it("rejects when the selector has no account", async () => {
    installNarwalletsBridge();
    const { wallet } = await createNarWallet();

    await expect(wallet.signMessage!(signMessageParams)).rejects.toThrow(
      "Wallet not signed in"
    );
  });

  it("asks the extension to sign and returns the signature", async () => {
    const posted = installNarwalletsBridge();
    const { wallet } = await signedInNarWallet();

    const signed = await wallet.signMessage!(signMessageParams);

    const request = posted.find((message) => message.code === "sign-message");
    expect(request?.params).toEqual({
      message: signMessageParams.message,
      recipient: signMessageParams.recipient,
      nonce: Array.from(signMessageParams.nonce),
      callbackUrl: signMessageParams.callbackUrl,
      state: signMessageParams.state,
      accountId: undefined,
    });
    expect(signed).toEqual({
      accountId: signedAccountId,
      publicKey,
      signature,
      state: "returned-state",
    });
  });
});

describe("signNep413Message", () => {
  it("returns a near-js public key and raw signature bytes", async () => {
    installNarwalletsBridge();
    const { wallet } = await signedInNarWallet();

    const signed = await wallet.signNep413Message!(
      signMessageParams.message,
      signedAccountId,
      signMessageParams.recipient,
      signMessageParams.nonce,
      signMessageParams.callbackUrl
    );

    expect(signed.accountId).toEqual(signedAccountId);
    expect(signed.publicKey.toString()).toEqual(publicKey);
    expect(Buffer.from(signed.signature).toString("base64")).toEqual(signature);
    expect(signed.state).toEqual("returned-state");
  });
});
