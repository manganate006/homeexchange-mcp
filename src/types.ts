// ─── Auth ────────────────────────────────────────────────────────────────────

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  userAgent: string;
  source?: string;
  /** PHPSESSID cookie value — used to call BFF /authentication/refresh for auto-renewal. */
  sessionCookie?: string;
}

// ─── Home / Property ─────────────────────────────────────────────────────────

export interface HomeData {
  id: number;
  type: number;
  capacity: number;
  guestpoint: number;
  completion_rate: number;
  is_he_collection: boolean;
  contact_allowed: boolean;
  global_rating: number | null;
  min_nights: number | null;
  prefers_reciprocal: boolean;
  shared_part: number;
  location: { latitude: number; longitude: number };
  translated_admins: {
    admin1?: string;
    admin2?: string;
    admin3?: string;
    country?: string;
  };
  user: HomeUser;
  detail: HomeDetail;
  feature: HomeFeatures;
  descriptions: HomeDescription[];
  images: HomeImage[];
  tag?: { is_location_interested?: boolean };
}

export interface HomeUser {
  id: number;
  first_name: string;
  number_exchange: number;
  response_rate: number;
  global_rating: number | null;
  verified_status: string;
  verified_only: boolean;
  images: { cdn_link: string }[];
}

export interface HomeDetail {
  bedroom_nb: number;
  bathroom_nb: number;
  double_bed: number;
  single_bed: number;
  children_bed: number;
  big_double_bed: number;
  baby_bed: number;
  size: number;
  localized_size: string;
}

export interface HomeFeatures {
  multimedia?: number;
  practical?: number;
  outdoor?: number;
  kids?: number;
  transportation?: number;
}

export interface HomeDescription {
  title?: string;
  translated_title?: string;
  good_feature?: string;
  good_place?: string;
  other?: string;
}

export interface HomeImage {
  cdn_link: string;
  type: "HOME" | "USER";
}

// ─── Calendar ────────────────────────────────────────────────────────────────

export interface CalendarPeriod {
  start: string;
  end: string;
  status: number; // 1=available, 2=unavailable, 3=maybe
}

export interface CalendarData {
  periods: CalendarPeriod[];
}

// ─── Ratings ─────────────────────────────────────────────────────────────────

export interface Rating {
  id: number;
  clean: number;
  expectation: number;
  communication: number;
  feedback: string;
  created_at: string;
  author: {
    id: number;
    first_name: string;
    images?: { cdn_link: string }[];
  };
  extra_data?: {
    nb_night?: number;
    start_on?: string;
    type?: "host" | "guest";
  };
}

// ─── Conversations ───────────────────────────────────────────────────────────

export interface ConversationEdge {
  node: Conversation;
}

export interface Conversation {
  id: number;
  title: string;
  message_count: number;
  unread_messages_count: number;
  created_at: string;
  updated_at: string;
  last_message?: Message;
  exchanges?: Exchange[];
}

export interface Exchange {
  id: number;
  start_on: string;
  end_on: string;
  type: string;
  status: string;
  guest: { id: number; first_name: string };
  host: { id: number; first_name: string };
  home: { id: number };
}

export interface ConversationsResponse {
  data: {
    conversations: {
      edges: ConversationEdge[];
      totalCount?: number;
      pageInfo?: {
        hasNextPage: boolean;
        endCursor?: string;
      };
    };
  };
}

// ─── Messages ────────────────────────────────────────────────────────────────

export interface Message {
  id: number;
  content: string;
  status: number; // 1=read
  type: number; // 0=user, 1=system
  type_auto: number | null;
  send_at: string;
  author: MessageAuthor;
}

export interface MessageAuthor {
  id: number;
  first_name: string;
  locale: string;
  verified_status: string;
  images?: { cdn_link: string }[];
}

export interface MessagesResponse {
  data: {
    messages: Message[];
  };
}

// ─── Write operations ────────────────────────────────────────────────────────

export interface SendMessageParams {
  conversationId: number;
  content: string;
}

export interface UpdateCalendarParams {
  homeId: number;
  periods: {
    start: string;
    end: string;
    status: number; // 1=available, 2=unavailable, 3=maybe
  }[];
}

export interface UpdateHomeParams {
  homeId: number;
  fields: Record<string, unknown>;
}
