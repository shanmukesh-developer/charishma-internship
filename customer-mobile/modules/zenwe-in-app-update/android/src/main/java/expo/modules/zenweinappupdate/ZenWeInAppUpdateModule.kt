package expo.modules.zenweinappupdate

import android.app.Activity
import android.os.Build
import com.google.android.play.core.appupdate.AppUpdateInfo
import com.google.android.play.core.appupdate.AppUpdateManager
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.InstallException
import com.google.android.play.core.install.InstallState
import com.google.android.play.core.install.InstallStateUpdatedListener
import com.google.android.play.core.install.model.ActivityResult
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.InstallStatus
import com.google.android.play.core.install.model.UpdateAvailability
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val UPDATE_REQUEST_CODE = 52741
private const val EVENT_INSTALL_STATE = "onInstallState"

/**
 * ZenWe in-app updates: a thin wrapper over Google Play's AppUpdateManager.
 *
 *   checkForUpdate()  -> { available, inProgress, versionCode, flexibleAllowed, immediateAllowed, stalenessDays,
 *                          priority, installStatus, bytesDownloaded, totalBytes, installedFromPlay }
 *   startFlexible()   -> "accepted" | "canceled" | "failed" | "not_allowed" | "not_started"
 *   startImmediate()  -> same (Play's full-screen flow; on success Play restarts the app)
 *   completeUpdate()  -> installs a downloaded flexible update (the app restarts)
 *   event onInstallState { status, bytesDownloaded, totalBytes, errorCode }
 *
 * Every Play failure (app not installed from Play, no Play Store, emulator without Play) rejects with
 * ERR_IN_APP_UPDATE so the JS side can fall back to opening the store listing.
 */
class ZenWeInAppUpdateModule : Module() {
  private var manager: AppUpdateManager? = null
  private var pendingStart: Promise? = null

  private val installListener = InstallStateUpdatedListener { state: InstallState ->
    try {
      sendEvent(
        EVENT_INSTALL_STATE,
        mapOf(
          "status" to statusName(state.installStatus()),
          "bytesDownloaded" to state.bytesDownloaded().toDouble(),
          "totalBytes" to state.totalBytesToDownload().toDouble(),
          "errorCode" to state.installErrorCode()
        )
      )
    } catch (_: Throwable) {
      // The JS runtime is gone (app reloading): nothing to tell.
    }
  }

  private fun managerOrThrow(): AppUpdateManager {
    manager?.let { return it }
    val context = appContext.reactContext?.applicationContext
      ?: throw CodedException("ERR_IN_APP_UPDATE", "No Android context", null)
    val created = AppUpdateManagerFactory.create(context)
    created.registerListener(installListener)
    manager = created
    return created
  }

  override fun definition() = ModuleDefinition {
    Name("ZenWeInAppUpdate")

    Events(EVENT_INSTALL_STATE)

    AsyncFunction("checkForUpdate") { promise: Promise ->
      val m = try { managerOrThrow() } catch (e: Throwable) { promise.reject(toCoded(e)); return@AsyncFunction }
      m.appUpdateInfo
        .addOnSuccessListener { info -> promise.resolve(describe(info)) }
        .addOnFailureListener { e -> promise.reject(toCoded(e)) }
    }

    AsyncFunction("startFlexible") { promise: Promise -> start(AppUpdateType.FLEXIBLE, promise) }

    AsyncFunction("startImmediate") { promise: Promise -> start(AppUpdateType.IMMEDIATE, promise) }

    AsyncFunction("completeUpdate") { promise: Promise ->
      val m = try { managerOrThrow() } catch (e: Throwable) { promise.reject(toCoded(e)); return@AsyncFunction }
      m.completeUpdate()
        .addOnSuccessListener { promise.resolve(true) }
        .addOnFailureListener { e -> promise.reject(toCoded(e)) }
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != UPDATE_REQUEST_CODE) return@OnActivityResult
      val p = pendingStart ?: return@OnActivityResult
      pendingStart = null
      p.resolve(
        when (payload.resultCode) {
          Activity.RESULT_OK -> "accepted"
          Activity.RESULT_CANCELED -> "canceled"
          ActivityResult.RESULT_IN_APP_UPDATE_FAILED -> "failed"
          else -> "failed"
        }
      )
    }

    OnDestroy {
      try { manager?.unregisterListener(installListener) } catch (_: Throwable) {}
      manager = null
      pendingStart?.resolve("canceled")
      pendingStart = null
    }
  }

  private fun start(type: Int, promise: Promise) {
    val m = try { managerOrThrow() } catch (e: Throwable) { promise.reject(toCoded(e)); return }
    m.appUpdateInfo
      .addOnSuccessListener { info ->
        val inProgress = info.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS
        val available = info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE
        // An interrupted immediate update is resumed with the same call (Google's recommendation).
        if (!(available || (inProgress && type == AppUpdateType.IMMEDIATE)) || !info.isUpdateTypeAllowed(type)) {
          promise.resolve("not_allowed")
          return@addOnSuccessListener
        }
        val activity = appContext.currentActivity
        if (activity == null) {
          promise.resolve("not_started")
          return@addOnSuccessListener
        }
        try {
          pendingStart?.resolve("canceled")
          pendingStart = promise
          val started = m.startUpdateFlowForResult(
            info,
            activity,
            AppUpdateOptions.newBuilder(type).build(),
            UPDATE_REQUEST_CODE
          )
          if (!started) {
            pendingStart = null
            promise.resolve("not_started")
          }
        } catch (e: Throwable) {
          if (pendingStart === promise) pendingStart = null
          promise.reject(toCoded(e))
        }
      }
      .addOnFailureListener { e -> promise.reject(toCoded(e)) }
  }

  private fun describe(info: AppUpdateInfo): Map<String, Any?> {
    val availability = info.updateAvailability()
    return mapOf(
      "available" to (availability == UpdateAvailability.UPDATE_AVAILABLE),
      "inProgress" to (availability == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS),
      "versionCode" to info.availableVersionCode(),
      "flexibleAllowed" to info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE),
      "immediateAllowed" to info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE),
      "stalenessDays" to info.clientVersionStalenessDays(),
      "priority" to info.updatePriority(),
      "installStatus" to statusName(info.installStatus()),
      "bytesDownloaded" to info.bytesDownloaded().toDouble(),
      "totalBytes" to info.totalBytesToDownload().toDouble(),
      "installedFromPlay" to installedFromPlay()
    )
  }

  /** Play answers "no update" (not an error) for a sideloaded APK, so the installer is checked too. */
  private fun installedFromPlay(): Boolean = try {
    val context = appContext.reactContext?.applicationContext
    val pm = context?.packageManager
    val pkg = context?.packageName
    val installer = if (pm == null || pkg == null) null
      else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) pm.getInstallSourceInfo(pkg).installingPackageName
      else @Suppress("DEPRECATION") pm.getInstallerPackageName(pkg)
    installer == "com.android.vending"
  } catch (_: Throwable) {
    false
  }

  private fun statusName(status: Int): String = when (status) {
    InstallStatus.PENDING -> "pending"
    InstallStatus.DOWNLOADING -> "downloading"
    InstallStatus.DOWNLOADED -> "downloaded"
    InstallStatus.INSTALLING -> "installing"
    InstallStatus.INSTALLED -> "installed"
    InstallStatus.FAILED -> "failed"
    InstallStatus.CANCELED -> "canceled"
    else -> "unknown"
  }

  private fun toCoded(e: Throwable): CodedException {
    if (e is CodedException) return e
    val code = if (e is InstallException) " (Play error ${e.errorCode})" else ""
    return CodedException("ERR_IN_APP_UPDATE", (e.message ?: "In-app update unavailable") + code, e)
  }
}
