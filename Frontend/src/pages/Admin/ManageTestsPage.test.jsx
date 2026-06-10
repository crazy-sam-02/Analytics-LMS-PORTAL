import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDispatch,
  mockNavigate,
  mockLocation,
  mockState,
  fetchAdminTests,
  transitionAdminTestStatus,
  deleteAdminTest,
  openTestEditDialog,
  openTestCreationDialog,
} = vi.hoisted(() => {
  const dispatch = vi.fn();
  const navigate = vi.fn();
  const location = { pathname: "/admin/tests", search: "?create=1" };
  const state = {
    adminAuth: {
      permissions: ["create_test", "view_tests"],
    },
    adminPanel: {
      tests: {
        data: [],
        loading: false,
        pagination: {},
        statusCounts: {},
      },
    },
  };
  const fetchAdminTestsMock = vi.fn((queryString) => ({ type: "adminPanel/fetchAdminTests", payload: queryString }));
  const transitionAdminTestStatusMock = vi.fn();
  const deleteAdminTestMock = vi.fn();
  const openTestEditDialogMock = vi.fn();
  const openTestCreationDialogMock = vi.fn(() => ({ type: "testCreation/openDialog" }));

  return {
    mockDispatch: dispatch,
    mockNavigate: navigate,
    mockLocation: location,
    mockState: state,
    fetchAdminTests: fetchAdminTestsMock,
    transitionAdminTestStatus: transitionAdminTestStatusMock,
    deleteAdminTest: deleteAdminTestMock,
    openTestEditDialog: openTestEditDialogMock,
    openTestCreationDialog: openTestCreationDialogMock,
  };
});

vi.mock("react-redux", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useDispatch: () => mockDispatch,
    useSelector: (selector) => selector(mockState),
  };
});

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useLocation: () => mockLocation,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("@/features/Admin/adminPanelSlice", () => ({
  fetchAdminTests,
  transitionAdminTestStatus,
  deleteAdminTest,
}));

vi.mock("@/features/Admin/testCreationSlice", () => ({
  openTestEditDialog,
  openTestCreationDialog,
}));

vi.mock("@/components/Admin/TestCreationDialog", () => ({
  default: () => <div data-testid="test-creation-dialog" />,
}));

vi.mock("@/components/Admin/PermissionDenied", () => ({
  default: ({ action }) => <div data-testid="permission-denied">{action}</div>,
}));

vi.mock("@/services/api", () => ({
  adminApi: {
    getTestById: vi.fn(),
  },
}));

import ManageTestsPage from "@/pages/Admin/ManageTestsPage";

describe("ManageTestsPage create navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocation.search = "?create=1";
  });

  it("opens the creation dialog when the create query flag is present", async () => {
    render(<ManageTestsPage />);

    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith({ type: "testCreation/openDialog" });
    });

    expect(mockNavigate).toHaveBeenCalledWith("/admin/tests", { replace: true });
  });
});