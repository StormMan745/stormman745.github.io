package app.petcare.companion;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.ActivityNotFoundException;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PetCareNotificationSound")
public class PetCareNotificationSoundPlugin extends Plugin {
    private static final String CHANNEL_ID = "petcare_reminders_v1";

    private NotificationManager manager() {
        return (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager notifications = manager();
        // Never delete or recreate a channel that the owner may have silenced.
        if (notifications.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Напоминания PetCare", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Ежедневные дела, лекарства и напоминания о питомцах");
        channel.setSound(Settings.System.DEFAULT_NOTIFICATION_URI, new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[] { 0, 180, 100, 180 });
        channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        notifications.createNotificationChannel(channel);
    }

    private JSObject soundStatus() {
        JSObject result = new JSObject();
        result.put("channelId", CHANNEL_ID);
        result.put("appEnabled", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        AudioManager audio = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        result.put("ringerNormal", audio.getRingerMode() == AudioManager.RINGER_MODE_NORMAL);
        result.put("volume", audio.getStreamVolume(AudioManager.STREAM_NOTIFICATION));
        Uri sound = RingtoneManager.getActualDefaultRingtoneUri(getContext(), RingtoneManager.TYPE_NOTIFICATION);
        int importance = NotificationManager.IMPORTANCE_DEFAULT;
        boolean ready = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = manager().getNotificationChannel(CHANNEL_ID);
            ready = channel != null;
            if (channel != null) {
                importance = channel.getImportance();
                Uri chosenSound = channel.getSound();
                if (!Settings.System.DEFAULT_NOTIFICATION_URI.equals(chosenSound)) sound = chosenSound;
            }
        }
        result.put("channelReady", ready);
        result.put("channelEnabled", ready && importance > NotificationManager.IMPORTANCE_NONE);
        result.put("soundEnabled", ready && importance >= NotificationManager.IMPORTANCE_DEFAULT && sound != null);
        return result;
    }

    @PluginMethod
    public void configure(PluginCall call) {
        try {
            ensureChannel();
            // Diagnostics must never prevent an otherwise valid reminder schedule.
            JSObject result = new JSObject(); result.put("channelId", CHANNEL_ID); call.resolve(result);
        }
        catch (Exception error) { call.reject("Не удалось настроить канал уведомлений.", error); }
    }

    @PluginMethod
    public void status(PluginCall call) {
        try { call.resolve(soundStatus()); }
        catch (Exception error) { call.reject("Не удалось проверить настройки звука.", error); }
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                ensureChannel();
                Intent intent;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    intent = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName())
                        .putExtra(Settings.EXTRA_CHANNEL_ID, CHANNEL_ID);
                } else {
                    intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
                }
                try { getActivity().startActivity(intent); }
                catch (ActivityNotFoundException error) {
                    getActivity().startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.parse("package:" + getContext().getPackageName())));
                }
                call.resolve();
            } catch (Exception error) { call.reject("Не удалось открыть настройки уведомлений.", error); }
        });
    }
}
