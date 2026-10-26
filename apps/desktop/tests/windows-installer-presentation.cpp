#define WIN32_LEAN_AND_MEAN
#define UNICODE
#include <windows.h>

extern "C" __declspec(dllimport) BOOL __cdecl InstallerPresentWelcome(HWND window);
extern "C" __declspec(dllimport) HWND __cdecl InstallerShowProgress(HWND parent, HWND source,
    BOOL dark, UINT dpi, const WCHAR* brand, const WCHAR* preparing, const WCHAR* extracting,
    const WCHAR* copying, const WCHAR* registering, const WCHAR* cleaning);
extern "C" __declspec(dllimport) BOOL __cdecl InstallerFinishProgress(HWND window);

static bool Above(HWND upper, HWND lower) {
    for (HWND current = GetWindow(lower, GW_HWNDPREV); current;
         current = GetWindow(current, GW_HWNDPREV)) {
        if (current == upper) return true;
    }
    return false;
}

int wmain(int argc, wchar_t** argv) {
    if (argc != 2) return 10;
    HINSTANCE instance = GetModuleHandleW(nullptr);
    HWND installer = CreateWindowExW(0, L"STATIC", L"Installer", WS_POPUP,
                                     100, 100, 300, 300, nullptr, nullptr, instance, nullptr);
    HWND other = CreateWindowExW(0, L"STATIC", L"Other", WS_POPUP,
                                 120, 120, 300, 300, nullptr, nullptr, instance, nullptr);
    if (!installer || !other) return 1;
    ShowWindow(installer, SW_SHOW);
    ShowWindow(other, SW_SHOW);
    if (!Above(other, installer)) return 2;
    if (!InstallerPresentWelcome(installer)) return 3;
    if (!Above(installer, other)) return 4;
    if (GetWindowLongPtrW(installer, GWL_EXSTYLE) & WS_EX_TOPMOST) return 5;
    if (GetPropW(installer, L"HarnessInstaller.Presented") != reinterpret_cast<HANDLE>(1)) return 6;

    HWND source = CreateWindowExW(0, L"STATIC", L"Stock progress", WS_CHILD,
        0, 0, 100, 20, installer, nullptr, instance, nullptr);
    if (!source) return 7;
    HWND progress = InstallerShowProgress(installer, source, FALSE, 96, argv[1],
        L"Preparing %d%%", L"Extracting %d%%", L"Copying %d%%", L"Registering %d%%", L"Cleaning %d%%");
    if (!progress) return 8;
    if (!InstallerFinishProgress(progress)) return 9;
    if (GetPropW(installer, L"HarnessInstaller.Succeeded") != reinterpret_cast<HANDLE>(1)) return 11;
    if (GetPropW(installer, L"HarnessInstaller.CompletedPercent") != reinterpret_cast<HANDLE>(100)) return 12;
    DestroyWindow(progress);
    DestroyWindow(source);
    DestroyWindow(other);
    DestroyWindow(installer);
    return 0;
}
