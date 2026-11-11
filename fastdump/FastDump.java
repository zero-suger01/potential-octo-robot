// Doimiy UI-dump serveri. `uiautomator dump` har chaqiruvda yangi Java jarayonini ishga tushiradi va
// ekran 1 s "tinch" turishini kutadi (~2.2 s). Bu server qurilmadagi o'sha /system/framework/uiautomator.jar
// klasslari bilan BIR MARTA ulanadi va har so'rovda shu XML'ni beradi (~0.3–0.6 s).
//
// Ishga tushirish (qurilmada):
//   CLASSPATH=/system/framework/uiautomator.jar:/data/local/tmp/fastdump.jar app_process /system/bin FastDump
// Protokol (stdin → stdout): "d <tinchMs>\n" → XML, so'ng "\n<<END>>\n"; xato bo'lsa "<<ERR>> matn\n<<END>>\n".
// Server faqat ekranni O'QIYDI — hech narsani bosmaydi.

import android.app.UiAutomation;
import android.graphics.Point;
import android.view.Display;
import android.view.accessibility.AccessibilityNodeInfo;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.nio.file.Files;

public class FastDump {
  public static void main(String[] args) throws Exception {
    Class<?> wrapperCls = Class.forName("com.android.uiautomator.core.UiAutomationShellWrapper");
    Object wrapper = wrapperCls.getConstructor().newInstance();
    wrapperCls.getMethod("connect").invoke(wrapper);
    wrapperCls.getMethod("setCompressedLayoutHierarchy", boolean.class).invoke(wrapper, false);
    UiAutomation ua = (UiAutomation) wrapperCls.getMethod("getUiAutomation").invoke(wrapper);
    Method dumpToFile = Class.forName("com.android.uiautomator.core.AccessibilityNodeInfoDumper")
        .getMethod("dumpWindowToFile", AccessibilityNodeInfo.class, File.class, int.class, int.class, int.class);
    Object dmg = Class.forName("android.hardware.display.DisplayManagerGlobal").getMethod("getInstance").invoke(null);
    Method realDisplay = dmg.getClass().getMethod("getRealDisplay", int.class);
    Method clearCache = null;
    try { clearCache = UiAutomation.class.getMethod("clearCache"); } catch (NoSuchMethodException ignored) {}

    File out = new File("/data/local/tmp/fastdump.xml");
    OutputStream so = System.out;
    so.write("<<READY>>\n".getBytes());
    so.flush();

    BufferedReader in = new BufferedReader(new InputStreamReader(System.in));
    String line;
    while ((line = in.readLine()) != null) {
      line = line.trim();
      if (line.equals("q")) break;
      if (!line.startsWith("d")) continue;
      long quiet = 400;
      try { quiet = Long.parseLong(line.substring(1).trim()); } catch (Exception ignored) {}
      try {
        try { ua.waitForIdle(quiet, 5000); } catch (Exception ignored) {} // band ekran — baribir o'qiymiz
        if (clearCache != null) clearCache.invoke(ua);
        AccessibilityNodeInfo root = null;
        for (int i = 0; i < 10 && root == null; i++) {
          root = ua.getRootInActiveWindow();
          if (root == null) Thread.sleep(100);
        }
        if (root == null) throw new IllegalStateException("null root node");
        Display display = (Display) realDisplay.invoke(dmg, Display.DEFAULT_DISPLAY);
        Point size = new Point();
        display.getRealSize(size);
        dumpToFile.invoke(null, root, out, display.getRotation(), size.x, size.y);
        so.write(Files.readAllBytes(out.toPath()));
        so.write("\n<<END>>\n".getBytes());
      } catch (Throwable e) {
        Throwable c = e.getCause() != null ? e.getCause() : e;
        so.write(("<<ERR>> " + c + "\n<<END>>\n").getBytes());
      }
      so.flush();
    }
    wrapperCls.getMethod("disconnect").invoke(wrapper);
  }
}
