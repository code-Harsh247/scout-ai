import os
from dotenv import load_dotenv
from typing import TypedDict, Annotated
from langgraph.graph import StateGraph, END
from agents.ui_ux_agent import run_audit

# 1. Load your API keys from the .env file
load_dotenv()

# 2. Define the State (what information gets passed around)
class ScoutState(TypedDict):
    target_url: str
    audit_report: str
    errors: str

# 3. Define the Nodes (the steps in our workflow)
def run_ui_ux_audit(state: ScoutState):
    print(f"🕵️‍♂️ Scout.ai is analyzing: {state['target_url']}...")
    report = run_audit(state["target_url"])
    return {"audit_report": report}

# 4. Build the Graph (wire it all together)
workflow = StateGraph(ScoutState)

# Add our single node for now
workflow.add_node("ui_ux_auditor", run_ui_ux_audit)

# Define the flow
workflow.set_entry_point("ui_ux_auditor")
workflow.add_edge("ui_ux_auditor", END)

# Compile the graph into an executable app
scout_app = workflow.compile()

# 5. The Test Runner
if __name__ == "__main__":
    print("🚀 Scout.ai Initialized!")
    test_url = input("Enter a URL to audit (e.g., https://example.com): ")
    
    # Run the graph
    result = scout_app.invoke({"target_url": test_url})
    
    print("\n" + "="*50)
    print("📋 FINAL AUDIT REPORT:")
    print("="*50)
    print(result["audit_report"])