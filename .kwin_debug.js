var windows = workspace.windowList();
for (var i = 0; i < windows.length; i++) {
    var w = windows[i];
    console.log("KWIN_DEBUG: class=" + w.resourceClass + " | name=" + w.resourceName + " | caption=" + w.caption + " | appId=" + (w.desktopFileName || "N/A"));
}
