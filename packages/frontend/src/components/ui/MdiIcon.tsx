import {
  Bed,
  Bell,
  Blinds,
  Bolt,
  Bot,
  Calendar,
  Camera,
  Car,
  Clock,
  Cog,
  DoorOpen,
  Fan,
  Flame,
  Home,
  Lamp,
  Lightbulb,
  Lock,
  type LucideIcon,
  Moon,
  Music,
  Play,
  Power,
  Radio,
  ScrollText,
  Shield,
  Snowflake,
  Speaker,
  Sun,
  Thermometer,
  Tv,
  Volume2,
  Wifi,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The `mdi:` icons an automation or script commonly carries, drawn with the closest lucide icon.
 * Flow ships no Material Design Icons set (Home Assistant's own `ha-icon` is not available inside
 * the panel's iframe), so any other name falls back to `ScrollText` and keeps its name as a tooltip.
 */
const MDI_TO_LUCIDE: Record<string, LucideIcon> = {
  bed: Bed,
  'bed-empty': Bed,
  bell: Bell,
  'bell-ring': Bell,
  blinds: Blinds,
  'blinds-open': Blinds,
  calendar: Calendar,
  camera: Camera,
  car: Car,
  clock: Clock,
  'clock-outline': Clock,
  cog: Cog,
  door: DoorOpen,
  'door-open': DoorOpen,
  fan: Fan,
  fire: Flame,
  flash: Bolt,
  home: Home,
  lamp: Lamp,
  lightbulb: Lightbulb,
  'lightbulb-group': Lightbulb,
  'lightbulb-outline': Lightbulb,
  lock: Lock,
  music: Music,
  play: Play,
  power: Power,
  radio: Radio,
  robot: Bot,
  'shield-home': Shield,
  snowflake: Snowflake,
  speaker: Speaker,
  television: Tv,
  thermometer: Thermometer,
  'volume-high': Volume2,
  'weather-night': Moon,
  'weather-sunny': Sun,
  'white-balance-sunny': Sun,
  wifi: Wifi,
};

interface MdiIconProps {
  /** An `mdi:name` icon, or nothing */
  icon?: string;
  className?: string;
}

export function MdiIcon({ icon, className }: MdiIconProps) {
  const name = icon?.startsWith('mdi:') ? icon.slice(4) : undefined;
  const Icon = (name && MDI_TO_LUCIDE[name]) || ScrollText;
  return (
    <Icon className={cn('shrink-0', className)} aria-hidden>
      {icon ? <title>{icon}</title> : null}
    </Icon>
  );
}
