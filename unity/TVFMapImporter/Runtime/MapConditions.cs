using System;
using System.Collections.Generic;
using UnityEngine;

namespace TVF
{
    /// <summary>
    /// The story state that map conditions are checked against: chapter index, time slot index and the set story flags
    /// (flag ids from the map export). Change it from game code; every MapElement updates itself on OnChanged.
    /// </summary>
    public static class MapState
    {
        static int chapter, time;
        public static readonly HashSet<string> Flags = new HashSet<string>();

        /// <summary>Raised after Chapter, Time or Flags change.</summary>
        public static event Action OnChanged;

        public static int Chapter
        {
            get => chapter;
            set { if (chapter == value) return; chapter = value; NotifyChanged(); }
        }

        public static int Time
        {
            get => time;
            set { if (time == value) return; time = value; NotifyChanged(); }
        }

        public static bool HasFlag(string id) => !string.IsNullOrEmpty(id) && Flags.Contains(id);

        public static void SetFlag(string id, bool on = true)
        {
            if (string.IsNullOrEmpty(id)) return;
            bool changed = on ? Flags.Add(id) : Flags.Remove(id);
            if (changed) NotifyChanged();
        }

        /// <summary>Sets chapter and time together, raising OnChanged once.</summary>
        public static void Set(int newChapter, int newTime)
        {
            if (chapter == newChapter && time == newTime) return;
            chapter = newChapter;
            time = newTime;
            NotifyChanged();
        }

        public static void Clear()
        {
            chapter = time = 0;
            Flags.Clear();
            NotifyChanged();
        }

        /// <summary>Call after editing Flags directly.</summary>
        public static void NotifyChanged() => OnChanged?.Invoke();

        // Static state survives play sessions when domain reload is turned off; start each session clean.
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetForPlayMode()
        {
            chapter = time = 0;
            Flags.Clear();
            OnChanged = null;
        }
    }

    public static class MapConditions
    {
        /// <summary>True when the condition holds for the current MapState.</summary>
        public static bool IsMet(Cond cond) => IsMet(cond, MapState.Chapter, MapState.Time, MapState.Flags);

        /// <summary>
        /// chMin &lt;= chapter &lt;= chMax (a bound of -1 is ignored), times empty or containing the time slot,
        /// flag set (when given) and notFlag not set (when given).
        /// </summary>
        public static bool IsMet(Cond cond, int chapter, int time, ICollection<string> flags)
        {
            if (cond == null) return true;
            if (cond.chMin >= 0 && chapter < cond.chMin) return false;
            if (cond.chMax >= 0 && chapter > cond.chMax) return false;
            if (cond.times != null && cond.times.Length > 0 && Array.IndexOf(cond.times, time) < 0) return false;
            if (!string.IsNullOrEmpty(cond.flag) && (flags == null || !flags.Contains(cond.flag))) return false;
            if (!string.IsNullOrEmpty(cond.notFlag) && flags != null && flags.Contains(cond.notFlag)) return false;
            return true;
        }
    }
}
