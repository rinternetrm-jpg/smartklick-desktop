"""
Command Parser for Smartklick Wake Word Service

Parses voice commands into structured actions with 60+ commands in 11 categories.
"""

import re
from dataclasses import dataclass
from typing import Optional, Dict, List, Tuple, Any
from enum import Enum


class CommandCategory(Enum):
    """Command categories"""
    SYSTEM = "system"
    APP = "app"
    WEB = "web"
    MEDIA = "media"
    REMINDER = "reminder"
    COMMUNICATION = "communication"
    SEARCH = "search"
    SMART_HOME = "smart_home"
    NAVIGATION = "navigation"
    SETTINGS = "settings"
    HELP = "help"
    UNKNOWN = "unknown"


@dataclass
class ParsedCommand:
    """Structured command result"""
    category: CommandCategory
    action: str
    parameters: Dict[str, Any]
    confidence: float
    raw_text: str
    matched_pattern: Optional[str] = None


class CommandParser:
    """
    Parses transcribed text into structured commands.
    Supports German and English commands with fuzzy matching.
    """

    def __init__(self):
        self.command_patterns = self._build_command_patterns()
        self.exit_reminder_patterns = self._build_exit_reminder_patterns()

    def _build_command_patterns(self) -> Dict[CommandCategory, List[Tuple[str, str, Dict]]]:
        """
        Build command patterns for each category.
        Each pattern is: (regex_pattern, action_name, default_params)
        """
        return {
            # ============ SYSTEM COMMANDS ============
            CommandCategory.SYSTEM: [
                (r"(?:computer|system|pc)\s*(?:herunterfahren|ausschalten|shutdown)", "shutdown", {}),
                (r"(?:computer|system|pc)\s*(?:neustarten|restart|reboot)", "restart", {}),
                (r"(?:bildschirm|screen)\s*(?:sperren|lock)", "lock_screen", {}),
                (r"(?:lautst[aä]rke|volume)\s*(?:auf|to|auf)\s*(\d+)", "set_volume", {"level": None}),
                (r"(?:lautst[aä]rke|volume)\s*(?:lauter|up|erh[oö]hen)", "volume_up", {}),
                (r"(?:lautst[aä]rke|volume)\s*(?:leiser|down|verringern)", "volume_down", {}),
                (r"(?:ton|sound)\s*(?:aus|mute|stumm)", "mute", {}),
                (r"(?:ton|sound)\s*(?:an|unmute|laut)", "unmute", {}),
                (r"(?:helligkeit|brightness)\s*(?:auf|to)\s*(\d+)", "set_brightness", {"level": None}),
                (r"(?:screenshot|bildschirmfoto)\s*(?:machen|erstellen)?", "screenshot", {}),
                (r"(?:zwischenablage|clipboard)\s*(?:leeren|clear)", "clear_clipboard", {}),
            ],

            # ============ APP COMMANDS ============
            CommandCategory.APP: [
                (r"(?:[oö]ffne|open|starte|start)\s+(.+)", "open_app", {"app_name": None}),
                (r"(?:schlie[sß]e|close|beende|quit)\s+(.+)", "close_app", {"app_name": None}),
                (r"(?:wechsle zu|switch to|gehe zu)\s+(.+)", "switch_app", {"app_name": None}),
                (r"(?:minimiere|minimize)\s+(.+)?", "minimize_app", {"app_name": None}),
                (r"(?:maximiere|maximize)\s+(.+)?", "maximize_app", {"app_name": None}),
                (r"neues?\s*(?:fenster|window)", "new_window", {}),
                (r"neuer?\s*(?:tab)", "new_tab", {}),
                (r"(?:tab|fenster)\s*schlie[sß]en", "close_tab", {}),
            ],

            # ============ WEB COMMANDS ============
            CommandCategory.WEB: [
                (r"(?:gehe zu|go to|[oö]ffne)\s*(?:webseite|website|seite)?\s*(.+\.(?:com|de|org|net|io))", "open_url", {"url": None}),
                (r"(?:google|suche|search)\s*(?:nach)?\s*(.+)", "web_search", {"query": None}),
                (r"(?:youtube)\s*(?:suche|search)?\s*(.+)?", "youtube_search", {"query": None}),
                (r"(?:wikipedia)\s*(.+)?", "wikipedia_search", {"query": None}),
                (r"(?:amazon)\s*(?:suche|search)?\s*(.+)?", "amazon_search", {"query": None}),
                (r"(?:nachrichten|news)\s*(?:zu|about)?\s*(.+)?", "news_search", {"topic": None}),
                (r"(?:wetter|weather)\s*(?:in|for)?\s*(.+)?", "weather", {"location": None}),
                (r"(?:seite|page)\s*(?:aktualisieren|refresh|neu laden)", "refresh_page", {}),
                (r"(?:zur[uü]ck|back)", "browser_back", {}),
                (r"(?:vorw[aä]rts|forward)", "browser_forward", {}),
            ],

            # ============ MEDIA COMMANDS ============
            CommandCategory.MEDIA: [
                (r"(?:spiele|play|abspielen)\s*(?:musik|music)?", "play", {}),
                (r"(?:pause|pausieren|stopp|stop)", "pause", {}),
                (r"(?:n[aä]chster?\s*(?:titel|song|track)|next|skip)", "next_track", {}),
                (r"(?:vorheriger?\s*(?:titel|song|track)|previous|zur[uü]ck)", "previous_track", {}),
                (r"(?:wiederhole|repeat)\s*(?:titel|song|track)?", "repeat", {}),
                (r"(?:shuffle|zuf[aä]llig|mischen)", "shuffle", {}),
                (r"(?:spiele|play)\s+(.+)\s+(?:von|by)\s+(.+)", "play_song_by_artist", {"song": None, "artist": None}),
                (r"(?:spiele|play)\s+(?:album|playlist)\s+(.+)", "play_album", {"album": None}),
            ],

            # ============ REMINDER / EXIT REMINDER COMMANDS ============
            CommandCategory.REMINDER: [
                # Exit Reminder specific - handled separately
                (r"(?:erinnere mich|remind me)\s+(?:wenn ich|when i)\s+(?:bei|at|in)\s+(.+)\s+(?:bin|arrive|ankomme)", "exit_reminder_arrive", {"location": None}),
                (r"(?:erinnere mich|remind me)\s+(?:wenn ich|when i)\s+(.+)\s+(?:verlasse|leave)", "exit_reminder_leave", {"location": None}),
                (r"(?:erinnere mich|remind me)\s+(?:an|to|about)\s+(.+)", "create_reminder", {"message": None}),
                (r"(?:timer|wecker)\s+(?:auf|for|in)\s+(\d+)\s*(?:minuten?|minutes?|sekunden?|seconds?|stunden?|hours?)", "set_timer", {"duration": None, "unit": None}),
                (r"(?:zeige|show)\s*(?:meine)?\s*(?:erinnerungen|reminders)", "show_reminders", {}),
                (r"(?:l[oö]sche|delete|entferne)\s*(?:erinnerung|reminder)\s*(.+)?", "delete_reminder", {"reminder_id": None}),
            ],

            # ============ COMMUNICATION COMMANDS ============
            CommandCategory.COMMUNICATION: [
                (r"(?:anrufen|call|ruf an)\s+(.+)", "call", {"contact": None}),
                (r"(?:nachricht|message|sms)\s+(?:an|to)\s+(.+)", "send_message", {"contact": None}),
                (r"(?:email|e-mail|mail)\s+(?:an|to)\s+(.+)", "send_email", {"contact": None}),
                (r"(?:whatsapp)\s+(?:an|to)\s+(.+)", "send_whatsapp", {"contact": None}),
                (r"(?:lies|read)\s*(?:meine)?\s*(?:nachrichten|messages|emails?)", "read_messages", {}),
            ],

            # ============ SEARCH COMMANDS ============
            CommandCategory.SEARCH: [
                (r"(?:suche|search|find)\s+(?:datei|file)\s+(.+)", "search_file", {"filename": None}),
                (r"(?:suche|search|find)\s+(?:in|within)\s+(.+)\s+(?:nach|for)\s+(.+)", "search_in_app", {"app": None, "query": None}),
                (r"(?:was ist|what is|wer ist|who is)\s+(.+)", "knowledge_query", {"query": None}),
                (r"(?:definiere|define)\s+(.+)", "define", {"term": None}),
                (r"(?:[uü]bersetze|translate)\s+(.+)\s+(?:auf|to|ins?)\s+(.+)", "translate", {"text": None, "target_lang": None}),
            ],

            # ============ SMART HOME COMMANDS ============
            CommandCategory.SMART_HOME: [
                (r"(?:licht|light)\s+(?:an|on|einschalten)", "light_on", {}),
                (r"(?:licht|light)\s+(?:aus|off|ausschalten)", "light_off", {}),
                (r"(?:licht|light)\s+(?:auf|to)\s+(\d+)\s*(?:prozent|%)?", "light_brightness", {"level": None}),
                (r"(?:licht|light)\s+(?:farbe|color)\s+(.+)", "light_color", {"color": None}),
                (r"(?:temperatur|temperature|heizung|heating)\s+(?:auf|to)\s+(\d+)", "set_temperature", {"temp": None}),
                (r"(?:rolll[aä]den|blinds|jalousien)\s+(?:hoch|up|[oö]ffnen)", "blinds_up", {}),
                (r"(?:rolll[aä]den|blinds|jalousien)\s+(?:runter|down|schlie[sß]en)", "blinds_down", {}),
            ],

            # ============ NAVIGATION COMMANDS ============
            CommandCategory.NAVIGATION: [
                (r"(?:navigiere|navigate|route)\s+(?:zu|to|nach)\s+(.+)", "navigate_to", {"destination": None}),
                (r"(?:wie komme ich|how do i get)\s+(?:zu|to|nach)\s+(.+)", "directions_to", {"destination": None}),
                (r"(?:wo ist|where is)\s+(.+)", "find_location", {"location": None}),
                (r"(?:zeige|show)\s*(?:karte|map)\s*(?:von|of)?\s*(.+)?", "show_map", {"location": None}),
            ],

            # ============ SETTINGS COMMANDS ============
            CommandCategory.SETTINGS: [
                (r"(?:[oö]ffne|open)\s*(?:einstellungen|settings)", "open_settings", {}),
                (r"(?:wlan|wifi)\s+(?:an|on|einschalten)", "wifi_on", {}),
                (r"(?:wlan|wifi)\s+(?:aus|off|ausschalten)", "wifi_off", {}),
                (r"(?:bluetooth)\s+(?:an|on|einschalten)", "bluetooth_on", {}),
                (r"(?:bluetooth)\s+(?:aus|off|ausschalten)", "bluetooth_off", {}),
                (r"(?:flugmodus|airplane mode)\s+(?:an|on|einschalten)", "airplane_on", {}),
                (r"(?:flugmodus|airplane mode)\s+(?:aus|off|ausschalten)", "airplane_off", {}),
                (r"(?:nicht st[oö]ren|do not disturb)\s+(?:an|on|einschalten)", "dnd_on", {}),
                (r"(?:nicht st[oö]ren|do not disturb)\s+(?:aus|off|ausschalten)", "dnd_off", {}),
            ],

            # ============ HELP COMMANDS ============
            CommandCategory.HELP: [
                (r"(?:hilfe|help|was kannst du)", "show_help", {}),
                (r"(?:befehle|commands)\s*(?:zeigen|show)?", "list_commands", {}),
                (r"(?:wie|how)\s+(?:mache ich|do i)\s+(.+)", "how_to", {"task": None}),
            ],
        }

    def _build_exit_reminder_patterns(self) -> List[Tuple[str, Dict]]:
        """
        Special patterns for Exit Reminder integration.
        More complex parsing for location-based reminders.
        """
        return [
            # "Erinnere mich wenn ich bei [ORT] bin an [NACHRICHT]"
            (r"erinnere mich\s+(?:wenn ich\s+)?(?:bei|in|an|am)\s+(.+?)\s+(?:bin|ankomme)\s+(?:an|dass|zu)\s+(.+)",
             {"trigger": "arrive", "location": 1, "message": 2}),

            # "Erinnere mich wenn ich [ORT] ankomme an [NACHRICHT]" (ohne Präposition)
            (r"erinnere mich\s+wenn ich\s+(.+?)\s+ankomme\s+(?:an|dass|zu)\s+(.+)",
             {"trigger": "arrive", "location": 1, "message": 2}),

            # "Erinnere mich wenn ich [ORT] verlasse an [NACHRICHT]"
            (r"erinnere mich\s+(?:wenn ich\s+)?(.+?)\s+(?:verlasse|gehe)\s+(?:an|dass|zu)\s+(.+)",
             {"trigger": "leave", "location": 1, "message": 2}),

            # "Bei [ORT]: [NACHRICHT]"
            (r"bei\s+(.+?):\s*(.+)",
             {"trigger": "arrive", "location": 1, "message": 2}),

            # "Wenn ich zuhause bin, erinnere mich an [NACHRICHT]"
            (r"wenn ich\s+(?:bei|in|an|am)?\s*(.+?)\s+(?:bin|ankomme),?\s*erinnere mich\s+(?:an|dass|zu)\s+(.+)",
             {"trigger": "arrive", "location": 1, "message": 2}),
        ]

    def parse(self, text: str) -> ParsedCommand:
        """
        Parse transcribed text into a structured command.

        Args:
            text: The transcribed voice command

        Returns:
            ParsedCommand with action, parameters, and confidence
        """
        # Normalize text
        text_lower = text.lower().strip()

        # First check for Exit Reminder patterns (higher priority)
        exit_reminder_result = self._parse_exit_reminder(text_lower)
        if exit_reminder_result:
            return exit_reminder_result

        # Check all category patterns
        best_match = None
        best_confidence = 0.0

        for category, patterns in self.command_patterns.items():
            for pattern, action, default_params in patterns:
                match = re.search(pattern, text_lower, re.IGNORECASE)
                if match:
                    # Calculate confidence based on match quality
                    confidence = self._calculate_confidence(text_lower, pattern, match)

                    if confidence > best_confidence:
                        # Extract parameters from match groups
                        params = default_params.copy()
                        param_keys = [k for k, v in params.items() if v is None]

                        for i, key in enumerate(param_keys):
                            if i < len(match.groups()) and match.group(i + 1):
                                params[key] = match.group(i + 1).strip()

                        best_match = ParsedCommand(
                            category=category,
                            action=action,
                            parameters=params,
                            confidence=confidence,
                            raw_text=text,
                            matched_pattern=pattern
                        )
                        best_confidence = confidence

        if best_match:
            return best_match

        # No match found - return unknown command
        return ParsedCommand(
            category=CommandCategory.UNKNOWN,
            action="unknown",
            parameters={"raw_text": text},
            confidence=0.0,
            raw_text=text
        )

    def _parse_exit_reminder(self, text: str) -> Optional[ParsedCommand]:
        """
        Special parser for Exit Reminder commands.
        Returns ParsedCommand or None if no match.
        """
        for pattern, groups in self.exit_reminder_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                location_group = groups.get("location", 1)
                message_group = groups.get("message", 2)
                trigger = groups.get("trigger", "arrive")

                location = match.group(location_group).strip() if location_group <= len(match.groups()) else None
                message = match.group(message_group).strip() if message_group <= len(match.groups()) else None

                # Normalize common location names
                location = self._normalize_location(location)

                return ParsedCommand(
                    category=CommandCategory.REMINDER,
                    action=f"exit_reminder_{trigger}",
                    parameters={
                        "location": location,
                        "message": message,
                        "trigger_on_enter": trigger == "arrive"
                    },
                    confidence=0.9,
                    raw_text=text,
                    matched_pattern=pattern
                )

        return None

    def _normalize_location(self, location: str) -> str:
        """
        Normalize common location names.
        E.g., "zuhause" -> "Zuhause", "der arbeit" -> "Arbeit"
        """
        if not location:
            return location

        # Remove common prefixes
        location = re.sub(r"^(der|die|das|dem|den|meiner?|meinem?)\s+", "", location, flags=re.IGNORECASE)

        # Common location mappings
        mappings = {
            "zuhause": "Zuhause",
            "zu hause": "Zuhause",
            "daheim": "Zuhause",
            "arbeit": "Arbeit",
            "büro": "Arbeit",
            "office": "Arbeit",
            "schule": "Schule",
            "uni": "Universität",
            "universität": "Universität",
            "supermarkt": "Supermarkt",
            "einkaufen": "Supermarkt",
            "gym": "Fitnessstudio",
            "fitnessstudio": "Fitnessstudio",
            "sport": "Fitnessstudio",
        }

        location_lower = location.lower()
        if location_lower in mappings:
            return mappings[location_lower]

        # Capitalize first letter
        return location.capitalize()

    def _calculate_confidence(self, text: str, pattern: str, match: re.Match) -> float:
        """
        Calculate confidence score for a pattern match.
        Based on match coverage and specificity.
        """
        # Base confidence for any match
        confidence = 0.6

        # Boost for longer matches (more specific)
        match_length = match.end() - match.start()
        text_length = len(text)
        coverage = match_length / text_length if text_length > 0 else 0
        confidence += coverage * 0.3

        # Boost if match starts at beginning
        if match.start() == 0:
            confidence += 0.1

        return min(confidence, 1.0)

    def get_available_commands(self) -> Dict[str, List[str]]:
        """
        Returns a dict of categories and their available commands.
        Useful for help/documentation.
        """
        result = {}
        for category, patterns in self.command_patterns.items():
            result[category.value] = [action for _, action, _ in patterns]
        return result


# For testing
if __name__ == "__main__":
    parser = CommandParser()

    test_commands = [
        "Öffne Chrome",
        "Lautstärke auf 50",
        "Erinnere mich wenn ich bei der Arbeit bin an Meeting vorbereiten",
        "Spiele Musik",
        "Google nach Python Tutorial",
        "Licht auf 70 Prozent",
        "Computer herunterfahren",
        "Was ist die Hauptstadt von Frankreich",
        "Erinnere mich wenn ich Zuhause ankomme an Wäsche waschen",
    ]

    print("=== Command Parser Test ===\n")
    for cmd in test_commands:
        result = parser.parse(cmd)
        print(f"Input: {cmd}")
        print(f"  Category: {result.category.value}")
        print(f"  Action: {result.action}")
        print(f"  Parameters: {result.parameters}")
        print(f"  Confidence: {result.confidence:.2f}")
        print()
